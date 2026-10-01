# Follow account scope into the health panel

ReadApi.List resolves the authenticated account through Session.Account before handling the requested resource. The health branch uses that account's MerchantId in every operational count and in the reconciliation history query. Client-supplied display data does not choose the merchant whose refunds are counted.

The branch returns pendingRefunds for compatibility and the two more useful partitions. The worker's retry selection uses the same attempt boundary, while the existing order action remains responsible for explicitly retrying an exhausted refund. The dashboard guides a user toward that action instead of trying to perform it from a summary card.

On the frontend, src/lib/health.ts exports HealthStat and healthStats. The Panels component calls this mapping and renders label, value, and optional help. Keeping the mapping in a small pure function makes the semantics testable without starting a browser or importing the full panel tree.

RefundHealthTests creates two merchants, their owner accounts, orders, and refund fixtures in an isolated PostgreSQL database. It calls the real API function with authenticated claims and reads the returned result object. The helper script creates that database and enables the guarded test. An ordinary unit invocation skips this database case unless the owned-environment marker is present. Trace these boundaries independently when a count, label, or authorization result is wrong.

## Source excerpt

From [services/Fulfil/Services/ReadApi.cs](../services/Fulfil/Services/ReadApi.cs).

```cs
        if (resource == "health")
        {
            var runs = await db.Reconciliations.Where(x => x.MerchantId == a.MerchantId).OrderByDescending(x => x.CreatedAt).Take(30).ToListAsync();
            return Results.Ok(new
            {
                items = runs,
                stuckSagas = await db.Orders.CountAsync(x => x.MerchantId == a.MerchantId && x.Attempts >= 12),
                pendingRefunds = await db.Refunds.CountAsync(x => x.MerchantId == a.MerchantId && x.State == "pending"),
                retryableRefunds = await db.Refunds.CountAsync(x => x.MerchantId == a.MerchantId && x.State == "pending" && x.Attempts < 12),
                stuckRefunds = await db.Refunds.CountAsync(x => x.MerchantId == a.MerchantId && x.State == "pending" && x.Attempts >= 12),
                deadLetters = await db.Outbox.CountAsync(x => x.MerchantId == a.MerchantId && x.State == "dead")
            });
        }
        if (resource == "replenishment")
        {
            var positions = await db.Inventory.Where(x => x.MerchantId == a.MerchantId).ToListAsync(); var purchases = await db.PurchaseOrders.Where(x => x.MerchantId == a.MerchantId && (x.State == "approved" || x.State == "partially_received")).ToListAsync(); var transfers = await db.Transfers.Where(x => x.MerchantId == a.MerchantId && (x.State == "in_transit" || x.State == "partially_received")).ToListAsync();
            var suggestions = positions.Select(i =>
            {
                var inbound = purchases.Where(x => x.WarehouseId == i.WarehouseId).Sum(x => Json.Read<List<PurchaseLine>>(x.LinesJson).Where(l => l.ProductId == i.ProductId).Sum(l => l.Quantity) - Json.Read<List<QuantityLine>>(x.ReceivedJson).Where(l => l.ProductId == i.ProductId).Sum(l => l.Quantity));
                var transit = transfers.Where(x => x.DestinationId == i.WarehouseId).Sum(x => Json.Read<List<QuantityLine>>(x.LinesJson).Where(l => l.ProductId == i.ProductId).Sum(l => l.Quantity) - Json.Read<List<QuantityLine>>(x.ReceivedJson).Concat(Json.Read<List<QuantityLine>>(x.LostJson)).Where(l => l.ProductId == i.ProductId).Sum(l => l.Quantity));
                return new { i.ProductId, i.WarehouseId, i.Available, inbound, transit, i.ReorderPoint, i.ReorderTarget, suggested = i.Available <= i.ReorderPoint ? Math.Max(0, i.ReorderTarget - i.Available - inbound - transit) : 0 };
            }).Where(x => x.suggested > 0).ToList(); return Results.Ok(new { items = suggestions, asOf = DateTime.UtcNow });
        }
        throw new DomainError("not_found", "Resource not found.", 404);
    }
    public static async Task<IResult> OrderDetail(Guid id, HttpContext c, IDbContextFactory<StockadeDb> factory)
    {
        await using var db = await factory.CreateDbContextAsync(); var a = Session.Actor(await Session.Account(c, db));
        var order = await db.Orders.AsNoTracking().SingleOrDefaultAsync(x => x.Id == id && x.MerchantId == a.MerchantId);
        if (order == null || a.Role == "customer" && order.CustomerId != a.Id || a.Role == "warehouse" && !await db.Reservations.AnyAsync(r => r.OrderId == id && r.WarehouseId == a.WarehouseId)) throw new DomainError("not_found", "Order not found.", 404);
        return Results.Ok(new { order, lines = Json.Read<List<OrderLine>>(order.LinesJson), events = await db.OrderEvents.Where(x => x.OrderId == id).OrderBy(x => x.CreatedAt).ToListAsync(), reservations = await db.Reservations.Where(x => x.OrderId == id && (a.WarehouseId == null || x.WarehouseId == a.WarehouseId)).ToListAsync(), fulfillments = await db.Fulfillments.Where(x => x.OrderId == id && (a.WarehouseId == null || x.WarehouseId == a.WarehouseId)).ToListAsync(), refunds = await db.Refunds.Where(x => x.OrderId == id).ToListAsync(), returns = await db.Returns.Where(x => x.OrderId == id).ToListAsync() });
    }
}
```

## Course navigation

[README](README.md) / [01-CODEBASE-MAP](01-CODEBASE-MAP.md) / [02-CONCEPTS](02-CONCEPTS.md) / [03-WORKED-CHANGE](03-WORKED-CHANGE.md) / [04-TESTING-AND-DEBUGGING](04-TESTING-AND-DEBUGGING.md) / [05-PRACTICE](05-PRACTICE.md) / [06-SOLUTIONS-AND-REVIEW](06-SOLUTIONS-AND-REVIEW.md) / [07-TRACE-LAB](07-TRACE-LAB.md) / [VERIFICATION](VERIFICATION.md)
