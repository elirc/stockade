# Make refund health actionable

Stockade's health view previously treated pending refunds as one undifferentiated group. That hides an operational distinction: some refunds remain eligible for worker retries, while others have reached the retry limit and need the existing authorized recovery action. The change exposes both counts and gives the latter group a concrete next step.

The API retains pendingRefunds and adds retryableRefunds and stuckRefunds. All three queries remain scoped to the authenticated account's merchant. A pending refund with fewer than twelve attempts is retryable; a pending refund with twelve or more attempts belongs in the recovery group. Successful refunds are excluded regardless of their historical attempt count.

The healthStats function converts these fields into visible labels and recovery guidance, and the panel renders that mapping. A small frontend regression protects the distinction and the zero-inventory-difference display. A new PostgreSQL test exercises the actual ReadApi health branch with two merchants and boundary values on both sides of twelve.

Follow the map from authenticated account to filtered counts, then use Concepts to calculate the boundary examples. The worked change separates query behavior from presentation. Practice and its separate solutions explore tenant isolation and retry eligibility. Verification explains exactly which local checks ran; neither provider refunds nor the operational retry workflow are executed by these tests. Existing recovery authorization remains the authority for taking action.

## Source excerpt

From [tests/Fulfil.Tests/RefundHealthTests.cs](../tests/Fulfil.Tests/RefundHealthTests.cs).

```cs
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

```

## Course navigation

[README](README.md) / [01-CODEBASE-MAP](01-CODEBASE-MAP.md) / [02-CONCEPTS](02-CONCEPTS.md) / [03-WORKED-CHANGE](03-WORKED-CHANGE.md) / [04-TESTING-AND-DEBUGGING](04-TESTING-AND-DEBUGGING.md) / [05-PRACTICE](05-PRACTICE.md) / [06-SOLUTIONS-AND-REVIEW](06-SOLUTIONS-AND-REVIEW.md) / [07-TRACE-LAB](07-TRACE-LAB.md) / [VERIFICATION](VERIFICATION.md)
