using Fulfil.Domain;
using Npgsql;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
namespace Fulfil.Data;

/// <summary>Bound active work before opening a serializable snapshot. Database constraints remain authoritative.</summary>
public static class Admission
{
    static readonly SemaphoreSlim[] Gates = Enumerable.Range(0, 256).Select(_ => new SemaphoreSlim(1, 1)).ToArray();
    public static async Task<IAsyncDisposable> Enter(string connectionString, Actor actor, string operation, JsonObject payload, CancellationToken ct)
    {
        var resources = new List<string>();
        foreach (var line in payload.List<QuantityLine>("lines")) resources.Add("product:" + line.ProductId);
        if (Guid.TryParse(payload.Text("productId"), out var product)) resources.Add("product:" + product);
        if (Guid.TryParse(payload.Text("id"), out var id)) resources.Add("record:" + id);
        var codes = payload.List<string>("promotions"); if (payload.Text("promotion").Length > 0) codes.Add(payload.Text("promotion"));
        resources.AddRange(codes.Select(x => "promotion:" + x.Trim().ToUpperInvariant()));
        if (resources.Count == 0) resources.Add("operation:" + operation);
        var stripes = resources.Select(r => (int)SHA256.HashData(Encoding.UTF8.GetBytes(actor.MerchantId + ":" + r))[0]).Distinct().Order().ToArray();
        var acquired = new List<SemaphoreSlim>(); NpgsqlConnection? connection = null;
        try
        {
            foreach (var stripe in stripes) { await Gates[stripe].WaitAsync(ct); acquired.Add(Gates[stripe]); }
            connection = new NpgsqlConnection(connectionString); await connection.OpenAsync(ct);
            foreach (var stripe in stripes)
            {
                // Session locks are taken before the transaction begins, so a waiter gets a fresh snapshot.
                await using var command = new NpgsqlCommand("SELECT pg_advisory_lock(835202,@stripe)", connection);
                command.Parameters.AddWithValue("stripe", stripe); await command.ExecuteNonQueryAsync(ct);
            }
            return new Lease(connection, acquired);
        }
        catch
        {
            if (connection != null) await Unlock(connection);
            foreach (var gate in acquired.AsEnumerable().Reverse()) gate.Release();
            throw;
        }
    }
    static async Task Unlock(NpgsqlConnection connection)
    {
        try
        {
            if (connection.State == System.Data.ConnectionState.Open)
            { await using var command = new NpgsqlCommand("SELECT pg_advisory_unlock_all()", connection) { CommandTimeout = 5 }; await command.ExecuteNonQueryAsync(); }
        }
        catch (NpgsqlException) { NpgsqlConnection.ClearPool(connection); }
        finally { await connection.DisposeAsync(); }
    }
    sealed class Lease(NpgsqlConnection connection, List<SemaphoreSlim> gates) : IAsyncDisposable
    {
        public async ValueTask DisposeAsync()
        { try { await Unlock(connection); } finally { foreach (var gate in gates.AsEnumerable().Reverse()) gate.Release(); } }
    }
}
