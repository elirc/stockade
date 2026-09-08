using Fulfil.Data;
using Microsoft.AspNetCore.DataProtection;
using Fulfil.Domain;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using System.Net;
using System.Net.Mail;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
namespace Fulfil.Services;

public sealed class Worker(IServiceScopeFactory scopes, ILogger<Worker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                using var scope = scopes.CreateScope();
                var factory = scope.ServiceProvider.GetRequiredService<IDbContextFactory<StockadeDb>>();
                await using var db = await factory.CreateDbContextAsync(stoppingToken);
                var ids = await db.Orders.Where(x => new[] { "pending", "authorizing", "authorized", "capturing", "unknown", "action_required", "void_pending" }.Contains(x.PaymentState) && x.Attempts < 12 && x.UpdatedAt < DateTime.UtcNow.AddSeconds(-2)).OrderBy(x => x.CreatedAt).Select(x => x.Id).Take(20).ToListAsync(stoppingToken);
                foreach (var id in ids) await ProcessOrder(scope.ServiceProvider, id, stoppingToken);
                var refunds = await db.Refunds.Where(x => x.State == "pending" && x.Attempts < 12).Select(x => x.Id).Take(20).ToListAsync(stoppingToken);
                foreach (var id in refunds) await ProcessRefund(scope.ServiceProvider, id, stoppingToken);
                await Expire(scope.ServiceProvider, stoppingToken);
                await Deliver(scope.ServiceProvider, stoppingToken);
                await ReconcileDue(scope.ServiceProvider, stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (Exception ex) { logger.LogError(ex, "Background recovery tick failed"); }
            await Task.Delay(1500, stoppingToken);
        }
    }
    static async Task<IAsyncDisposable?> Lease(IServiceProvider services, string key, CancellationToken ct)
    {
        var config = services.GetRequiredService<IConfiguration>(); var conn = new NpgsqlConnection(config.GetConnectionString("Database")); await conn.OpenAsync(ct);
        await using var cmd = new NpgsqlCommand("SELECT pg_try_advisory_lock(hashtextextended(@key,0))", conn); cmd.Parameters.AddWithValue("key", key);
        if ((bool)(await cmd.ExecuteScalarAsync(ct))!) return new SessionLease(conn);
        await conn.DisposeAsync(); return null;
    }
    sealed class SessionLease(NpgsqlConnection connection) : IAsyncDisposable
    {
        public async ValueTask DisposeAsync()
        {
            try
            {
                if (connection.State == System.Data.ConnectionState.Open)
                { await using var command = new NpgsqlCommand("SELECT pg_advisory_unlock_all()", connection) { CommandTimeout = 5 }; await command.ExecuteNonQueryAsync(); }
            }
            catch (NpgsqlException) { NpgsqlConnection.ClearPool(connection); }
            finally { await connection.DisposeAsync(); }
        }
    }
    async Task ProcessOrder(IServiceProvider s, Guid id, CancellationToken ct)
    {
        await using var lease = await Lease(s, "order:" + id, ct); if (lease == null) return;
        var factory = s.GetRequiredService<IDbContextFactory<StockadeDb>>(); var tx = s.GetRequiredService<Transactions>(); var payments = s.GetRequiredService<Payments>();
        await using var read = await factory.CreateDbContextAsync(ct);
        var order = await read.Orders.AsNoTracking().SingleAsync(x => x.Id == id, ct);
        try
        {
            if (order.PaymentState == "void_pending")
            {
                if (order.ProviderId != null)
                {
                    var remoteVoid = await payments.Retrieve(order.ProviderId); ValidatePayment(order, remoteVoid);
                    if (remoteVoid.State == "captured")
                    {
                        await CompleteCapture(tx, id, ct);
                        await tx.Run(async db => { var o = await db.Orders.SingleAsync(x => x.Id == id, ct); await Commerce.Release(db, o); var remaining = o.Captured - o.Refunded - o.RefundPending; if (remaining > 0) Commerce.ReserveRefund(db, o, remaining, "Cancellation after reconciled capture", null); Rules.Transition(o, "cancelled"); Emit(db, o, "cancelled", "Reconciled capture; cancellation refund queued."); return true; }, ct);
                        return;
                    }
                    if (remoteVoid.State != "voided") await payments.Void(order);
                }
                await tx.Run(async db => { var o = await db.Orders.SingleAsync(x => x.Id == id, ct); await Commerce.Release(db, o); o.PaymentState = "voided"; Rules.Transition(o, "cancelled"); Emit(db, o, "cancelled", "Authorization voided and stock released."); return true; }, ct); return;
            }
            if (order.ProviderId == null)
            {
                if (!await Stage(tx, id, "authorizing", ct)) return;
                var result = await payments.Authorize(order); ValidatePayment(order, result);
                await tx.Run(async db =>
                {
                    var o = await db.Orders.SingleAsync(x => x.Id == id, ct); o.ProviderId = result.Id; o.ClientSecret = result.ClientSecret; o.PaymentState = result.State; o.UpdatedAt = DateTime.UtcNow;
                    if (result.State == "authorized" && o.State != "authorized") Rules.Transition(o, "authorized");
                    if (result.State == "action_required" && o.State != "action_required") Rules.Transition(o, "action_required");
                    CompleteAttempt(db, o, "authorize", result.Id); return true;
                }, ct); if (result.State == "captured") await CompleteCapture(tx, id, ct); return;
            }
            var remote = payments.Mode == "Simulator" ? new PaymentResult(order.ProviderId, order.PaymentState == "capturing" ? "authorized" : order.PaymentState) : await payments.Retrieve(order.ProviderId);
            ValidatePayment(order, remote);
            if (remote.State == "action_required")
            {
                if (order.CreatedAt < DateTime.UtcNow.AddMinutes(-15))
                    await tx.Run(async db => { var o = await db.Orders.SingleAsync(x => x.Id == id, ct); o.PaymentState = "void_pending"; o.UpdatedAt = DateTime.UtcNow; return true; }, ct);
                return;
            }
            if (remote.State == "voided")
            {
                await tx.Run(async db => { var o = await db.Orders.SingleAsync(x => x.Id == id, ct); await Commerce.Release(db, o); Rules.Transition(o, "payment_failed"); o.PaymentState = "voided"; Emit(db, o, "payment_failed", "Provider confirmed the authorization was cancelled."); return true; }, ct);
                return;
            }
            if (remote.State == "captured") { await CompleteCapture(tx, id, ct); return; }
            if (remote.State != "authorized" && order.PaymentState != "authorized") throw new HttpRequestException("Payment outcome remains unknown.");
            var shouldCapture = await tx.Run(async db => { var o = await db.Orders.SingleAsync(x => x.Id == id, ct); if (o.PaymentState == "void_pending" || o.State is "cancelled" or "payment_failed" or "closed") return false; if (o.State == "action_required") Rules.Transition(o, "authorized"); if (o.State == "authorized") Rules.Transition(o, "placed"); o.PaymentState = "capturing"; o.UpdatedAt = DateTime.UtcNow; db.PaymentAttempts.Add(new PaymentAttempt { MerchantId = o.MerchantId, OrderId = id, Operation = "capture" }); return true; }, ct);
            if (!shouldCapture) return;
            var captured = await payments.Capture(order); ValidatePayment(order, captured); if (captured.State != "captured") throw new HttpRequestException("Capture has not been confirmed."); await CompleteCapture(tx, id, ct);
        }
        catch (PaymentDeclined ex)
        {
            if (order.ProviderId != null) { try { await payments.Void(order); } catch (Exception e) { logger.LogWarning(e, "Void uncertain for {OrderId}", id); await Unknown(tx, id, ex.Message, ct); return; } }
            await tx.Run(async db => { var o = await db.Orders.SingleAsync(x => x.Id == id, ct); await Commerce.Release(db, o); if (o.State != "payment_failed") Rules.Transition(o, "payment_failed"); o.PaymentState = "failed"; o.Error = ex.Message; Emit(db, o, "payment_failed", ex.Message); return true; }, ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        { logger.LogWarning(ex, "Payment reconciliation needed for {OrderId}", id); await Unknown(tx, id, ex.Message, ct); }
    }
    public static void ValidatePayment(Order order, PaymentResult result)
    {
        if (result.Amount.HasValue && result.Amount != order.Total || result.Currency != null && result.Currency != "usd" || result.State == "captured" && result.CapturedAmount.HasValue && result.CapturedAmount != order.Total)
            throw new HttpRequestException("Provider amount/currency differs from the immutable order; manual investigation required.");
    }
    static Task<bool> Stage(Transactions tx, Guid id, string state, CancellationToken ct) => tx.Run(async db => { var o = await db.Orders.SingleAsync(x => x.Id == id, ct); if (o.State is "cancelled" or "payment_failed" or "closed" || o.PaymentState == "expired") return false; o.PaymentState = state; o.UpdatedAt = DateTime.UtcNow; db.PaymentAttempts.Add(new PaymentAttempt { MerchantId = o.MerchantId, OrderId = id, Operation = "authorize" }); return true; }, ct);
    static Task<bool> Unknown(Transactions tx, Guid id, string error, CancellationToken ct) => tx.Run(async db => { var o = await db.Orders.SingleAsync(x => x.Id == id, ct); if (o.State is "cancelled" or "payment_failed" or "closed") return true; o.PaymentState = o.PaymentState == "void_pending" ? "void_pending" : "unknown"; o.Error = error.Length > 300 ? error[..300] : error; o.Attempts++; o.UpdatedAt = DateTime.UtcNow.AddSeconds(Math.Min(120, o.Attempts * 5)); return true; }, ct);
    static void CompleteAttempt(StockadeDb db, Order order, string op, string provider) => db.PaymentAttempts.Add(new PaymentAttempt { MerchantId = order.MerchantId, OrderId = order.Id, Operation = op, State = "succeeded", ProviderId = provider });
    static void Emit(StockadeDb db, Order o, string kind, string detail)
    { db.OrderEvents.Add(new OrderEvent { MerchantId = o.MerchantId, OrderId = o.Id, Kind = kind, Detail = detail }); db.Outbox.Add(new OutboxEvent { MerchantId = o.MerchantId, Kind = "order." + kind, Payload = Json.Write(new { orderId = o.Id, number = o.Number, email = o.Email, state = o.State, detail }) }); }
    static Task<bool> CompleteCapture(Transactions tx, Guid id, CancellationToken ct) => tx.Run(async db =>
    {
        var o = await db.Orders.SingleAsync(x => x.Id == id, ct); if (o.Captured == o.Total) return true;
        if (o.State is "reserved" or "action_required") Rules.Transition(o, "authorized");
        if (o.State == "authorized") Rules.Transition(o, "placed");
        var rows = await db.Reservations.Where(x => x.OrderId == id && x.State == "reserved").ToListAsync(ct);
        foreach (var r in rows) { var stock = await db.Inventory.SingleAsync(x => x.MerchantId == o.MerchantId && x.ProductId == r.ProductId && x.WarehouseId == r.WarehouseId, ct); stock.Reserved -= r.Quantity; stock.Held += r.Quantity; stock.Version++; r.State = "held"; }
        Rules.Transition(o, "paid"); o.PaymentState = "captured"; o.Captured = o.Total; o.Error = null; o.ClientSecret = null; CompleteAttempt(db, o, "capture", o.ProviderId!); Emit(db, o, "paid", "Payment captured; ready for fulfillment."); return true;
    }, ct);
    async Task ProcessRefund(IServiceProvider s, Guid id, CancellationToken ct)
    {
        await using var lease = await Lease(s, "refund:" + id, ct); if (lease == null) return;
        var tx = s.GetRequiredService<Transactions>(); var factory = s.GetRequiredService<IDbContextFactory<StockadeDb>>();
        await using var db = await factory.CreateDbContextAsync(ct);
        var refund = await db.Refunds.AsNoTracking().SingleAsync(x => x.Id == id, ct); if (refund.State != "pending") return;
        var order = await db.Orders.AsNoTracking().SingleAsync(x => x.Id == refund.OrderId, ct);
        try
        {
            var provider = await s.GetRequiredService<Payments>().Refund(order, refund);
            await tx.Run(async d => { var r = await d.Refunds.SingleAsync(x => x.Id == id, ct); if (r.State == "succeeded") return true; var o = await d.Orders.SingleAsync(x => x.Id == r.OrderId, ct); o.RefundPending -= r.Amount; o.Refunded += r.Amount; r.State = "succeeded"; r.ProviderId = provider; Emit(d, o, "refunded", $"Refund completed: {r.Amount} minor units."); return true; }, ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException) { logger.LogWarning(ex, "Refund {RefundId} remains pending", id); await tx.Run(async d => { var r = await d.Refunds.SingleAsync(x => x.Id == id, ct); r.Attempts++; return true; }, ct); }
    }
    static async Task Expire(IServiceProvider s, CancellationToken ct)
    {
        var tx = s.GetRequiredService<Transactions>();
        await tx.Run(async db =>
        {
            var ids = await db.Reservations.Where(x => x.State == "reserved" && x.ExpiresAt < DateTime.UtcNow).Select(x => x.OrderId).Distinct().Take(50).ToListAsync(ct);
            foreach (var id in ids)
            {
                var o = await db.Orders.SingleAsync(x => x.Id == id, ct);
                // Unknown provider effects retain stock until reconciliation; never treat a timeout as a decline.
                if (o.PaymentState != "pending" || o.ProviderId != null || await db.PaymentAttempts.AnyAsync(x => x.OrderId == id, ct)) continue;
                await Commerce.Release(db, o); Rules.Transition(o, "cancelled"); o.PaymentState = "expired"; Emit(db, o, "expired", "Reservation expired before payment began.");
            }
            return true;
        }, ct);
    }
    async Task Deliver(IServiceProvider s, CancellationToken ct)
    {
        var factory = s.GetRequiredService<IDbContextFactory<StockadeDb>>(); var tx = s.GetRequiredService<Transactions>();
        await using var db = await factory.CreateDbContextAsync(ct);
        var ids = await db.Outbox.Where(x => x.State == "pending" && x.AvailableAt < DateTime.UtcNow).OrderBy(x => x.CreatedAt).Select(x => x.Id).Take(20).ToListAsync(ct);
        foreach (var id in ids)
        {
            await using var lease = await Lease(s, "outbox:" + id, ct); if (lease == null) continue;
            var e = await db.Outbox.AsNoTracking().SingleAsync(x => x.Id == id, ct); if (e.State != "pending") continue;
            try
            {
                var data = JsonNode.Parse(e.Payload)!; var email = data["email"]?.GetValue<string>();
                if (e.Kind == "webhook")
                {
                    var subscriptionId = data["subscriptionId"]!.GetValue<Guid>();
                    var subscription = await db.Webhooks.AsNoTracking().SingleOrDefaultAsync(x => x.Id == subscriptionId && x.MerchantId == e.MerchantId, ct);
                    if (subscription?.Active == true) await Integrations.Deliver(subscription, e, s.GetRequiredService<IDataProtectionProvider>(), ct);
                }
                else if (email != null)
                {
                    var config = s.GetRequiredService<IConfiguration>();
                    using var smtp = new SmtpClient(config["Mail:Host"] ?? "127.0.0.1", int.Parse(config["Mail:Port"] ?? "1025"));
                    using var message = new MailMessage(config["Mail:From"] ?? "orders@stockade.local", email, "Stockade ? " + data["number"], data["detail"]?.GetValue<string>() ?? e.Kind);
                    message.Headers.Add("X-Stockade-Event", e.Id.ToString()); await smtp.SendMailAsync(message, ct);
                }
                await tx.Run(async d =>
                {
                    var ev = await d.Outbox.SingleAsync(x => x.Id == id, ct);
                    if (ev.State == "sent") return true;
                    if (ev.Kind != "webhook")
                    {
                        var subscribers = await d.Webhooks.Where(x => x.MerchantId == ev.MerchantId && x.Active).ToListAsync(ct);
                        foreach (var sub in subscribers) d.Outbox.Add(new OutboxEvent { MerchantId = ev.MerchantId, Kind = "webhook", Payload = Json.Write(new { subscriptionId = sub.Id, @event = new { id = ev.Id.ToString(), type = ev.Kind, createdAt = ev.CreatedAt, data = JsonNode.Parse(ev.Payload) } }) });
                    }
                    ev.State = "sent"; return true;
                }, ct);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                await tx.Run(async d => { var ev = await d.Outbox.SingleAsync(x => x.Id == id, ct); ev.Attempts++; ev.Error = ex.GetType().Name; ev.AvailableAt = DateTime.UtcNow.AddSeconds(Math.Min(3600, Math.Pow(2, ev.Attempts) * 5)); if (ev.Attempts >= 6) ev.State = "dead"; return true; }, ct);
            }
        }
    }
    static async Task ReconcileDue(IServiceProvider s, CancellationToken ct)
    {
        var tx = s.GetRequiredService<Transactions>();
        await tx.Run(async db =>
        {
            var merchants = await db.Merchants.ToListAsync(ct);
            foreach (var merchant in merchants)
            {
                if (await db.Reconciliations.AnyAsync(x => x.MerchantId == merchant.Id && x.CreatedAt > DateTime.UtcNow.AddDays(-1), ct)) continue;
                await Reconciliation.Run(db, merchant.Id, ct);
            }
            return true;
        }, ct);
    }
}
