# Calculate counts before changing code

Exercise one: for merchant A, classify pending refunds with attempt counts zero, eleven, twelve, and thirteen. Then add a succeeded refund at twenty. Predict all three API counts and the two visible refund cards. State why the successful row changes none of those counts.

Exercise two: give merchant B one pending refund at eleven and one at twelve. Remove MerchantId from only the stuckRefunds query in a disposable copy. Predict the incorrect value merchant A would see and identify which assertion detects it. Restore the predicate before accepting any test result.

Exercise three: change the comparison from less than twelve to less than or equal to twelve while leaving the recovery predicate unchanged. Explain why a refund at twelve appears in both groups. Describe the smallest boundary fixture that catches this overlap without relying on a large production dataset.

Exercise four: combine an account identifier from one merchant with another merchant claim. Predict whether the health query should execute and which existing identity lookup is responsible for the answer. Avoid assuming that merely possessing two syntactically valid identifiers grants access.

Exercise five: a refund succeeds between the three count queries. Explain why the returned total and partition counts may temporarily disagree even though each predicate is correct. Propose the extra reporting contract needed before introducing a transaction, and distinguish that proposal from the bounded change implemented here.

## Source excerpt

From [tests/Fulfil.Tests/RefundHealthTests.cs](../tests/Fulfil.Tests/RefundHealthTests.cs).

```cs
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
