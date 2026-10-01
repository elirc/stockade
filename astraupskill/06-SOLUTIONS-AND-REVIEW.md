# Check the arithmetic and the authority

Merchant A has four pending refunds: two below twelve and two at or above twelve. The succeeded row at twenty is excluded because all refund-health queries require pending state. The frontend therefore shows two retryable refunds and two needing retry guidance.

Removing merchant scope from the recovery query would include merchant B's pending refund at twelve, yielding three for A. The asymmetric fixture detects this directly. Symmetric one-row fixtures could conceal some query mistakes, so distinct expected totals are deliberate test data rather than decoration.

Using less than or equal to twelve for eligibility overlaps the greater-than-or-equal recovery group. A single pending refund with exactly twelve attempts exposes the error, but the full fixture also protects lower and higher values and state exclusion. The correct boundary divides the set without overlap when observed at one stable instant.

The mismatched claims fail account resolution and must not produce a health result. Authority comes from the account-and-merchant binding, not from a caller's chosen display filter. Recovery still requires the existing authorized order action.

Separate queries can observe different instants while a worker updates state. Snapshot-consistent reporting would require an explicit additional design decision, such as a suitable transaction or combined query. The present tests establish predicate behavior and isolation with stable fixtures; they do not establish an atomic dashboard snapshot, provider success, worker liveness, or browser interaction. Keep these distinctions in review summaries.

## Source excerpt

From [tests/Fulfil.Tests/RefundHealthTests.cs](../tests/Fulfil.Tests/RefundHealthTests.cs).

```cs
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
