using System.Security.Claims;
using System.Text.Json;
using Fulfil.Data;
using Fulfil.Domain;
using Fulfil.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Xunit;

public sealed class OwnedPostgresHealthFactAttribute : FactAttribute
{
    public OwnedPostgresHealthFactAttribute()
    {
        if (Environment.GetEnvironmentVariable("ASTRA5_OWNED_HEALTH_DATABASE") != "1")
            Skip = "Run python scripts/test-refund-health.py to use a helper-owned PostgreSQL cluster.";
    }
}

public class RefundHealthTests
{
    [OwnedPostgresHealthFact]
    public async Task HealthSeparatesRetryableAndExhaustedRefundsWithinTheAuthenticatedMerchant()
    {
        var connection = new NpgsqlConnectionStringBuilder(
            Environment.GetEnvironmentVariable("ASTRA5_HEALTH_TEST_CONNECTION"));
        Assert.Equal("127.0.0.1", connection.Host);
        Assert.Equal("astra5_health_test", connection.Database);
        Assert.Equal("astra_test", connection.Username);
        var options = new DbContextOptionsBuilder<StockadeDb>().UseNpgsql(connection.ConnectionString).Options;
        var factory = new FixtureFactory(options);
        await using var db = factory.CreateDbContext();
        await db.Database.EnsureCreatedAsync();

        var merchantA = new Merchant { Name = "A", Slug = "health-a" };
        var merchantB = new Merchant { Name = "B", Slug = "health-b" };
        var ownerA = new Account { MerchantId = merchantA.Id, Email = "owner-a@example.test", Role = "owner" };
        var ownerB = new Account { MerchantId = merchantB.Id, Email = "owner-b@example.test", Role = "owner" };
        var orderA = new Order { MerchantId = merchantA.Id, CustomerId = ownerA.Id, CheckoutKey = "health-a" };
        var orderB = new Order { MerchantId = merchantB.Id, CustomerId = ownerB.Id, CheckoutKey = "health-b" };
        db.Merchants.AddRange(merchantA, merchantB);
        db.Accounts.AddRange(ownerA, ownerB);
        db.Orders.AddRange(orderA, orderB);
        db.Refunds.AddRange(
            RefundFor(orderA, 0), RefundFor(orderA, 11), RefundFor(orderA, 12), RefundFor(orderA, 13),
            RefundFor(orderA, 20, "succeeded"),
            RefundFor(orderB, 11), RefundFor(orderB, 12), RefundFor(orderB, 12, "succeeded"));
        await db.SaveChangesAsync();

        var a = await ReadHealth(ownerA, factory);
        Assert.Equal(4, a.GetProperty("pendingRefunds").GetInt32());
        Assert.Equal(2, a.GetProperty("retryableRefunds").GetInt32());
        Assert.Equal(2, a.GetProperty("stuckRefunds").GetInt32());
        var b = await ReadHealth(ownerB, factory);
        Assert.Equal(2, b.GetProperty("pendingRefunds").GetInt32());
        Assert.Equal(1, b.GetProperty("retryableRefunds").GetInt32());
        Assert.Equal(1, b.GetProperty("stuckRefunds").GetInt32());

        var mismatchedIdentity = ContextFor(ownerA);
        mismatchedIdentity.User = new ClaimsPrincipal(new ClaimsIdentity(
            [new Claim(ClaimTypes.NameIdentifier, ownerA.Id.ToString()), new Claim("merchant", merchantB.Id.ToString())], "test"));
        await Assert.ThrowsAsync<DomainError>(() => ReadApi.List("health", mismatchedIdentity, factory));
    }

    private static Refund RefundFor(Order order, int attempts, string state = "pending") =>
        new() { MerchantId = order.MerchantId, OrderId = order.Id, Amount = 100, Attempts = attempts, State = state };

    private static DefaultHttpContext ContextFor(Account account) => new()
    {
        User = new ClaimsPrincipal(new ClaimsIdentity(
            [new Claim(ClaimTypes.NameIdentifier, account.Id.ToString()), new Claim("merchant", account.MerchantId.ToString())], "test")),
    };

    private static async Task<JsonElement> ReadHealth(Account account, IDbContextFactory<StockadeDb> factory)
    {
        var result = await ReadApi.List("health", ContextFor(account), factory);
        Assert.Equal(200, Assert.IsAssignableFrom<IStatusCodeHttpResult>(result).StatusCode);
        return JsonSerializer.SerializeToElement(Assert.IsAssignableFrom<IValueHttpResult>(result).Value);
    }

    private sealed class FixtureFactory(DbContextOptions<StockadeDb> options) : IDbContextFactory<StockadeDb>
    {
        public StockadeDb CreateDbContext() => new(options);
    }
}
