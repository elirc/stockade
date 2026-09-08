using System.Data;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using Fulfil.Domain;
using Microsoft.EntityFrameworkCore;
using Npgsql;
namespace Fulfil.Data;

public sealed class Transactions(IDbContextFactory<StockadeDb> factory, IConfiguration configuration)
{
    public async Task<T> Run<T>(Func<StockadeDb, Task<T>> action, CancellationToken ct = default)
    {
        for (var attempt = 0; ; attempt++)
        {
            await using var db = await factory.CreateDbContextAsync(ct);
            await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
            try { var result = await action(db); await db.SaveChangesAsync(ct); await tx.CommitAsync(ct); return result; }
            catch (Exception ex) when (attempt < 16 && Retryable(ex))
            { await tx.RollbackAsync(ct); await Task.Delay(Math.Min(200, 4 * (attempt + 1)) + Random.Shared.Next(1, 20), ct); }
        }
    }
    static bool Retryable(Exception ex) => ex is PostgresException p && p.SqlState is "40001" or "40P01" or "23505" || ex.InnerException is not null && Retryable(ex.InnerException);
    public async Task<JsonNode> Command(Actor actor, string key, string operation, JsonObject payload, Func<StockadeDb, Task<object>> action, CancellationToken ct = default)
    {
        if (key.Length < 8 || key.Length > 150) throw new DomainError("idempotency_key", "An Idempotency-Key of 8?150 characters is required.", 400);
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(actor.Id + ":" + operation + ":" + payload.ToJsonString())));
        await using var admission = await Admission.Enter(configuration.GetConnectionString("Database")!, actor, operation, payload, ct);
        return await Run(async db =>
        {
            var prior = await db.Commands.SingleOrDefaultAsync(x => x.MerchantId == actor.MerchantId && x.Key == key, ct);
            if (prior != null)
            {
                if (prior.PayloadHash != hash || prior.Operation != operation) throw new DomainError("idempotency_conflict", "This key was already used for a different request.", 409);
                return JsonNode.Parse(prior.ResultJson)!;
            }
            var result = await action(db);
            var json = Json.Write(result);
            db.Commands.Add(new CommandReceipt { MerchantId = actor.MerchantId, Key = key, Operation = operation, PayloadHash = hash, ResultJson = json });
            db.AuditEvents.Add(new AuditEvent { MerchantId = actor.MerchantId, ActorId = actor.Id, Action = operation, Detail = Json.Write(new { commandKey = key }) });
            return JsonNode.Parse(json)!;
        }, ct);
    }
}
