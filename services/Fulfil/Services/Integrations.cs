using Fulfil.Data;
using Fulfil.Domain;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using System.Net;
using System.Net.Sockets;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
namespace Fulfil.Services;

public static class Integrations
{
    public static readonly string[] Scopes = ["orders:read", "orders:write", "inventory:read", "inventory:write", "returns:write", "procurement:write"];
    public static string Hash(string value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value)));
    public static string Sign(string secret, string value) => Convert.ToHexString(HMACSHA256.HashData(Encoding.UTF8.GetBytes(secret), Encoding.UTF8.GetBytes(value))).ToLowerInvariant();
    public static bool Verify(string secret, string body, string header, long now)
    {
        var parts = header.Split(',').Select(x => x.Trim().Split('=', 2)).Where(x => x.Length == 2).ToList();
        if (!long.TryParse(parts.FirstOrDefault(x => x[0] == "t")?[1], out var timestamp) || (timestamp < now - 300 || timestamp > now + 300)) return false;
        var expected = Encoding.ASCII.GetBytes(Sign(secret, timestamp + "." + body));
        return parts.Where(x => x[0] == "v1").Any(x => CryptographicOperations.FixedTimeEquals(expected, Encoding.ASCII.GetBytes(x[1])));
    }
    public static Uri Destination(string url)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) || uri.Scheme != "https" || uri.Port != 443 || uri.UserInfo.Length > 0 || uri.Fragment.Length > 0)
            throw new DomainError("webhook_url", "Use an HTTPS webhook URL on port 443 without embedded credentials.");
        return uri;
    }
    public static bool PublicAddress(IPAddress address)
    {
        if (address.IsIPv4MappedToIPv6) address = address.MapToIPv4();
        if (IPAddress.IsLoopback(address)) return false;
        var b = address.GetAddressBytes();
        if (b.Length == 16) return !address.IsIPv6LinkLocal && !address.IsIPv6Multicast && !address.IsIPv6SiteLocal && (b[0] & 0xe0) == 0x20;
        return b[0] != 0 && b[0] != 10 && b[0] != 127 && b[0] < 224
            && !(b[0] == 169 && b[1] == 254) && !(b[0] == 172 && b[1] >= 16 && b[1] <= 31)
            && !(b[0] == 192 && (b[1] == 168 || b[1] == 0 || b[1] == 2)) && !(b[0] == 100 && b[1] >= 64 && b[1] <= 127)
            && !(b[0] == 198 && (b[1] == 18 || b[1] == 19 || b[1] == 51)) && !(b[0] == 203 && b[1] == 0 && b[2] == 113);
    }
    public static async Task Deliver(WebhookSubscription subscription, OutboxEvent delivery, IDataProtectionProvider protection, CancellationToken ct)
    {
        var uri = Destination(subscription.Url);
        using var handler = new SocketsHttpHandler { AllowAutoRedirect = false, UseProxy = false, ConnectTimeout = TimeSpan.FromSeconds(8) };
        handler.ConnectCallback = async (context, token) =>
        {
            var addresses = await Dns.GetHostAddressesAsync(context.DnsEndPoint.Host, token);
            if (addresses.Length == 0 || addresses.Any(x => !PublicAddress(x))) throw new HttpRequestException("Webhook destination is not public.");
            // Connect to the validated address; do not resolve the hostname a second time.
            var socket = new Socket(addresses[0].AddressFamily, SocketType.Stream, ProtocolType.Tcp);
            try { await socket.ConnectAsync(new IPEndPoint(addresses[0], 443), token); return new NetworkStream(socket, ownsSocket: true); }
            catch { socket.Dispose(); throw; }
        };
        using var client = new HttpClient(handler) { Timeout = TimeSpan.FromSeconds(15) };
        var envelope = JsonNode.Parse(delivery.Payload)!;
        var body = envelope["event"]!.ToJsonString();
        var timestamp = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        var secret = protection.CreateProtector("stockade.webhooks.v1").Unprotect(subscription.Secret);
        using var request = new HttpRequestMessage(HttpMethod.Post, uri) { Content = new StringContent(body, Encoding.UTF8, "application/json") };
        request.Headers.Add("Stockade-Signature", "t=" + timestamp + ",v1=" + Sign(secret, timestamp + "." + body));
        request.Headers.Add("Stockade-Event-Id", envelope["event"]!["id"]!.GetValue<string>());
        using var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct);
        if (!response.IsSuccessStatusCode) throw new HttpRequestException("Webhook delivery returned " + (int)response.StatusCode);
    }
    public static async Task AuthenticateKey(HttpContext c, IDbContextFactory<StockadeDb> factory)
    {
        var auth = c.Request.Headers.Authorization.ToString();
        if (!auth.StartsWith("Bearer ", StringComparison.Ordinal)) return;
        var token = auth[7..]; if (token.Length > 150) throw new DomainError("api_key", "Invalid API key.", 401);
        await using var db = await factory.CreateDbContextAsync();
        var hash = Hash(token); var key = await db.ApiKeys.SingleOrDefaultAsync(x => x.KeyHash == hash && x.Active);
        if (key == null) throw new DomainError("api_key", "Invalid or revoked API key.", 401);
        var account = await db.Accounts.SingleOrDefaultAsync(x => x.Id == key.AccountId && x.MerchantId == key.MerchantId);
        if (account == null || account.Role is not ("owner" or "admin")) throw new DomainError("api_key", "Key owner is unavailable.", 401);
        var path = c.Request.Path.Value ?? "";
        string? scope = null;
        if (c.Request.Method == "GET")
        {
            if (path.StartsWith("/api/v1/orders/") || path == "/api/v1/data/orders" || path == "/api/v1/data/returns") scope = "orders:read";
            if (new[] { "/api/v1/data/inventory", "/api/v1/data/warehouses", "/api/v1/data/adjustments", "/api/v1/data/transfers", "/api/v1/data/purchases", "/api/v1/data/counts", "/api/v1/data/suppliers", "/api/v1/data/replenishment" }.Contains(path)) scope = "inventory:read";
        }
        if (path.StartsWith("/api/v1/commands/") && c.Request.Method == "POST")
        {
            var op = path.Split('/').Last();
            scope = op.Split('.')[0] switch { "order" => "orders:write", "inventory" => "inventory:write", "transfer" => "inventory:write", "count" => "inventory:write", "purchase" => "procurement:write", "supplier" => "procurement:write", "return" => "returns:write", _ => null };
        }
        if (scope == null || !Json.Read<List<string>>(key.ScopesJson).Contains(scope)) throw new DomainError("api_scope", "This API key does not grant this operation.", 403);
        c.User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, account.Id.ToString()), new Claim("merchant", account.MerchantId.ToString()), new Claim("api-key", key.Id.ToString())], "ApiKey"));
    }
    public static void Map(WebApplication app, RouteGroupBuilder api, RouteGroupBuilder secure)
    {
        secure.MapGet("/integrations", async (HttpContext c, IDbContextFactory<StockadeDb> f) =>
        {
            await using var db = await f.CreateDbContextAsync(); var a = Session.Actor(await Session.Account(c, db)); a.Demand("owner", "admin");
            return new
            {
                keys = await db.ApiKeys.Where(x => x.MerchantId == a.MerchantId).Select(x => new { x.Id, x.Name, x.ScopesJson, x.Active, x.CreatedAt }).ToListAsync(),
                webhooks = await db.Webhooks.Where(x => x.MerchantId == a.MerchantId).Select(x => new { x.Id, x.Url, x.Active }).ToListAsync(),
                scopes = Scopes
            };
        });
        secure.MapPost("/integrations/keys", async (HttpContext c, Transactions tx, JsonObject p) =>
        {
            var token = "stk_" + Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant();
            var result = await tx.Run(async db =>
            {
                var a = Session.Actor(await Session.Account(c, db)); a.Demand("owner", "admin");
                var scopes = p.List<string>("scopes").Distinct().ToList(); if (scopes.Count == 0 || scopes.Any(x => !Scopes.Contains(x))) throw new DomainError("scopes", "Choose supported scopes.");
                var key = new ApiCredential { MerchantId = a.MerchantId, AccountId = a.Id, Name = p.Required("name", 100), KeyHash = Hash(token), ScopesJson = Json.Write(scopes) };
                db.ApiKeys.Add(key); db.AuditEvents.Add(new AuditEvent { MerchantId = a.MerchantId, ActorId = a.Id, Action = "api_key.created", Detail = key.Id.ToString() }); return key.Id;
            });
            return new { id = result, key = token };
        });
        secure.MapPost("/integrations/webhooks", async (HttpContext c, Transactions tx, IDataProtectionProvider protection, JsonObject p) =>
        {
            var secret = "whsec_" + Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant();
            var id = await tx.Run(async db =>
            {
                var a = Session.Actor(await Session.Account(c, db)); a.Demand("owner", "admin");
                var uri = Destination(p.Required("url", 2000));
                var row = new WebhookSubscription { MerchantId = a.MerchantId, Url = uri.AbsoluteUri, Secret = protection.CreateProtector("stockade.webhooks.v1").Protect(secret) };
                db.Webhooks.Add(row); db.AuditEvents.Add(new AuditEvent { MerchantId = a.MerchantId, ActorId = a.Id, Action = "webhook.created", Detail = row.Id.ToString() }); return row.Id;
            });
            return new { id, secret };
        });
        secure.MapPost("/integrations/{kind}/{id:guid}/revoke", async (string kind, Guid id, HttpContext c, Transactions tx) =>
            await tx.Run(async db =>
            {
                var a = Session.Actor(await Session.Account(c, db)); a.Demand("owner", "admin");
                if (kind == "keys") { var key = await db.ApiKeys.SingleOrDefaultAsync(x => x.Id == id && x.MerchantId == a.MerchantId) ?? throw new DomainError("not_found", "Key not found.", 404); key.Active = false; }
                else if (kind == "webhooks") { var hook = await db.Webhooks.SingleOrDefaultAsync(x => x.Id == id && x.MerchantId == a.MerchantId) ?? throw new DomainError("not_found", "Webhook not found.", 404); hook.Active = false; }
                else throw new DomainError("not_found", "Integration not found.", 404);
                db.AuditEvents.Add(new AuditEvent { MerchantId = a.MerchantId, ActorId = a.Id, Action = "integration.revoked", Detail = kind + ":" + id }); return new { revoked = true };
            }));
        api.MapPost("/stripe/webhook", async (HttpContext c, IConfiguration config, Transactions tx) =>
        {
            var secret = config["Payments:StripeWebhookSecret"]; if (string.IsNullOrEmpty(secret)) return Results.StatusCode(503);
            if (c.Request.ContentLength > 262144) return Results.StatusCode(413);
            using var reader = new StreamReader(c.Request.Body); var chars = new char[262145]; var count = await reader.ReadBlockAsync(chars.AsMemory(), c.RequestAborted);
            if (count > 262144) return Results.StatusCode(413); var body = new string(chars, 0, count);
            if (!Verify(secret, body, c.Request.Headers["Stripe-Signature"].ToString(), DateTimeOffset.UtcNow.ToUnixTimeSeconds())) return Results.Unauthorized();
            var e = JsonNode.Parse(body)!.AsObject();
            if (e["livemode"]?.GetValue<bool>() == true) throw new DomainError("stripe_mode", "Live events are disabled.");
            var eventId = e.Required("id", 150); var value = e["data"]?["object"];
            var provider = value?["id"]?.GetValue<string>();
            await tx.Run(async db =>
            {
                var order = await db.Orders.SingleOrDefaultAsync(x => x.ProviderId == provider);
                if (order == null) return true;
                var key = "stripe:" + eventId;
                if (await db.Commands.AnyAsync(x => x.MerchantId == order.MerchantId && x.Key == key)) return true;
                db.Commands.Add(new CommandReceipt { MerchantId = order.MerchantId, Key = key, Operation = "stripe.webhook", PayloadHash = Hash(body) });
                if (order.PaymentState is "unknown" or "action_required" or "authorizing" or "capturing" or "authorized")
                { order.Attempts = 0; order.UpdatedAt = DateTime.UtcNow.AddSeconds(-5); }
                db.AuditEvents.Add(new AuditEvent { MerchantId = order.MerchantId, Action = "stripe.webhook", Detail = eventId });
                return true;
            });
            // Signed events wake reconciliation; the worker retrieves authoritative provider state.
            return Results.Ok(new { received = true });
        });
    }
}
