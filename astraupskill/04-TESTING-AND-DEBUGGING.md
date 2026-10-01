# Use asymmetric merchant fixtures

The PostgreSQL fixture seeds merchant A with pending attempt counts zero, eleven, twelve, and thirteen, plus a succeeded refund at twenty. It expects four pending, two retryable, and two requiring recovery. Merchant B has pending eleven and twelve plus succeeded twelve, producing two, one, and one. Different totals make cross-merchant counting visible.

The test creates owner accounts and orders because refunds participate in real foreign-key relationships. EnsureCreated builds the model in a fresh helper-owned database. The actual ReadApi.List method resolves claims through the application's session logic and executes its EF queries against PostgreSQL. This is not an EF in-memory substitute or a fake list returned by a repository mock.

After both successful reads, the test combines owner A's account identifier with merchant B's claim. The account lookup must reject that mismatched identity with DomainError. This checks the binding that produces the query scope; it does not replace broader authentication and role-policy tests.

If the test is skipped, inspect the helper invocation and ownership marker before claiming database coverage. If seeding fails, inspect required relationships and constraints. If counts fail, compare state, attempt threshold, and merchant predicates independently. The frontend test can diagnose mapping mistakes without a database, but cannot establish query isolation on its own.

## Source excerpt

From [tests/Fulfil.Tests/RefundHealthTests.cs](../tests/Fulfil.Tests/RefundHealthTests.cs).

```cs
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
```

## Course navigation

[README](README.md) / [01-CODEBASE-MAP](01-CODEBASE-MAP.md) / [02-CONCEPTS](02-CONCEPTS.md) / [03-WORKED-CHANGE](03-WORKED-CHANGE.md) / [04-TESTING-AND-DEBUGGING](04-TESTING-AND-DEBUGGING.md) / [05-PRACTICE](05-PRACTICE.md) / [06-SOLUTIONS-AND-REVIEW](06-SOLUTIONS-AND-REVIEW.md) / [07-TRACE-LAB](07-TRACE-LAB.md) / [VERIFICATION](VERIFICATION.md)
