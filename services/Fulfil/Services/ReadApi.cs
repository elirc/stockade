using Fulfil.Data;
using Fulfil.Domain;
using Microsoft.EntityFrameworkCore;
namespace Fulfil.Services;

public static class ReadApi
{
    public static async Task<IResult> List(string resource, HttpContext c, IDbContextFactory<StockadeDb> factory)
    {
        await using var db = await factory.CreateDbContextAsync(); var account = await Session.Account(c, db); var a = Session.Actor(account);
        var page = int.TryParse(c.Request.Query["page"], out var pg) ? Math.Max(1, Math.Min(pg, 10000)) : 1;
        var size = int.TryParse(c.Request.Query["limit"], out var sz) ? Math.Clamp(sz, 1, 100) : 25;
        var query = c.Request.Query["q"].ToString().Trim(); if (query.Length > 100) query = query[..100];
        if (resource == "orders")
        {
            var rows = db.Orders.AsNoTracking().Where(x => x.MerchantId == a.MerchantId);
            if (a.Role == "customer") rows = rows.Where(x => x.CustomerId == a.Id);
            if (a.Role == "warehouse") rows = rows.Where(x => db.Reservations.Any(r => r.OrderId == x.Id && r.WarehouseId == a.WarehouseId));
            if (query.Length > 0) rows = rows.Where(x => EF.Functions.ILike(x.Number, "%" + query + "%") || EF.Functions.ILike(x.Email, "%" + query + "%"));
            var state = c.Request.Query["state"].ToString(); if (state.Length > 0 && state != "all") rows = rows.Where(x => x.State == state);
            if (DateTime.TryParse(c.Request.Query["before"], out var cursor)) rows = rows.Where(x => x.CreatedAt < cursor.ToUniversalTime());
            return Results.Ok(new { items = await rows.OrderByDescending(x => x.CreatedAt).ThenBy(x => x.Id).Skip((page - 1) * size).Take(size).Select(x => new { x.Id, x.Number, x.Email, x.State, x.PaymentState, x.FulfillmentState, x.Total, x.Captured, x.Refunded, x.RefundPending, x.CreatedAt, x.LinesJson }).ToListAsync(), total = await rows.CountAsync(), page });
        }
        if (resource == "returns")
        {
            var rows = db.Returns.AsNoTracking().Where(x => x.MerchantId == a.MerchantId);
            if (a.Role == "customer") rows = rows.Where(x => x.CustomerId == a.Id);
            if (a.Role == "warehouse" && a.WarehouseId != null) rows = rows.Where(x => x.WarehouseId == a.WarehouseId);
            return Results.Ok(new { items = await rows.OrderByDescending(x => x.CreatedAt).Take(100).ToListAsync() });
        }
        a.Demand("owner", "admin", "support", "warehouse");
        if (resource == "warehouses") return Results.Ok(new { items = await db.Warehouses.Where(x => x.MerchantId == a.MerchantId && (a.WarehouseId == null || x.Id == a.WarehouseId)).OrderBy(x => x.Priority).ToListAsync() });
        if (resource == "inventory")
        {
            var rows = from i in db.Inventory.AsNoTracking()
                       join p in db.Products on i.ProductId equals p.Id
                       join w in db.Warehouses on i.WarehouseId equals w.Id
                       where i.MerchantId == a.MerchantId && (a.WarehouseId == null || i.WarehouseId == a.WarehouseId)
                       select new { i.Id, i.ProductId, i.WarehouseId, i.OnHand, i.Reserved, i.Held, available = i.OnHand - i.Reserved - i.Held, i.Version, i.ReorderPoint, i.ReorderTarget, p.Sku, p.Name, p.Variant, p.Color, warehouse = w.Name, warehouseCode = w.Code, warehouseActive = w.Active };
            if (query.Length > 0) rows = rows.Where(x => EF.Functions.ILike(x.Name, "%" + query + "%") || EF.Functions.ILike(x.Sku, "%" + query + "%"));
            if (Guid.TryParse(c.Request.Query["warehouse"], out var warehouse)) rows = rows.Where(x => x.WarehouseId == warehouse);
            return Results.Ok(new { items = await rows.OrderBy(x => x.Name).ThenBy(x => x.warehouseCode).Skip((page - 1) * size).Take(size).ToListAsync(), total = await rows.CountAsync(), page });
        }
        if (resource == "adjustments") return Results.Ok(new { items = await db.Adjustments.Where(x => x.MerchantId == a.MerchantId && (a.WarehouseId == null || x.WarehouseId == a.WarehouseId)).OrderByDescending(x => x.CreatedAt).Take(100).ToListAsync() });
        if (resource == "transfers") return Results.Ok(new { items = await db.Transfers.Where(x => x.MerchantId == a.MerchantId && (a.WarehouseId == null || x.SourceId == a.WarehouseId || x.DestinationId == a.WarehouseId)).OrderByDescending(x => x.CreatedAt).Take(100).ToListAsync() });
        if (resource == "counts") return Results.Ok(new { items = await db.CycleCounts.Where(x => x.MerchantId == a.MerchantId && (a.WarehouseId == null || x.WarehouseId == a.WarehouseId)).OrderByDescending(x => x.CreatedAt).Take(100).ToListAsync() });
        if (resource == "purchases") return Results.Ok(new { items = await db.PurchaseOrders.Where(x => x.MerchantId == a.MerchantId && (a.WarehouseId == null || x.WarehouseId == a.WarehouseId)).OrderByDescending(x => x.CreatedAt).Take(100).ToListAsync() });
        if (resource == "suppliers") return Results.Ok(new { items = await db.Suppliers.Where(x => x.MerchantId == a.MerchantId).OrderBy(x => x.Name).ToListAsync() });
        if (resource == "dashboard")
        {
            a.Demand("owner", "admin", "support");
            var today = DateTime.UtcNow.Date; var orders = db.Orders.Where(x => x.MerchantId == a.MerchantId); var stocks = db.Inventory.Where(x => x.MerchantId == a.MerchantId);
            var recent = await orders.OrderByDescending(x => x.CreatedAt).Take(6).Select(x => new { x.Id, x.Number, x.Email, x.Total, x.State, x.CreatedAt }).ToListAsync();
            var low = await (from i in stocks join p in db.Products on i.ProductId equals p.Id join w in db.Warehouses on i.WarehouseId equals w.Id where i.OnHand - i.Reserved - i.Held <= i.ReorderPoint select new { i.ProductId, i.WarehouseId, p.Name, p.Sku, warehouse = w.Code, available = i.OnHand - i.Reserved - i.Held, i.ReorderPoint }).Take(6).ToListAsync();
            var history = await orders.Where(x => x.CreatedAt >= today.AddDays(-6)).GroupBy(x => x.CreatedAt.Date).Select(g => new { date = g.Key, revenue = g.Sum(x => x.Captured - x.Refunded), orders = g.Count() }).ToListAsync();
            return Results.Ok(new { orders = await orders.CountAsync(), revenue = await orders.SumAsync(x => x.Captured - x.Refunded), awaitingFulfillment = await orders.CountAsync(x => x.PaymentState == "captured" && x.FulfillmentState != "fulfilled" && x.State != "cancelled"), unitsAvailable = await stocks.SumAsync(x => x.OnHand - x.Reserved - x.Held), recent, low, history, openReturns = await db.Returns.CountAsync(x => x.MerchantId == a.MerchantId && x.State == "requested"), pendingTransfers = await db.Transfers.CountAsync(x => x.MerchantId == a.MerchantId && x.State == "in_transit") });
        }
        a.Demand("owner", "admin");
        if (resource == "promotions") return Results.Ok(new { items = await db.Promotions.Where(x => x.MerchantId == a.MerchantId).OrderByDescending(x => x.StartsAt).ToListAsync() });
        if (resource == "tax") return Results.Ok(new { items = await db.TaxRates.Where(x => x.MerchantId == a.MerchantId).OrderByDescending(x => x.Active).ToListAsync() });
        if (resource == "team") return Results.Ok(new { items = await db.Accounts.Where(x => x.MerchantId == a.MerchantId && x.Role != "customer").Select(x => new { x.Id, x.Name, x.Email, x.Role, x.WarehouseId }).ToListAsync() });
        if (resource == "audit") return Results.Ok(new { items = await db.AuditEvents.Where(x => x.MerchantId == a.MerchantId).OrderByDescending(x => x.CreatedAt).Take(100).ToListAsync() });
        if (resource == "outbox") return Results.Ok(new { items = await db.Outbox.Where(x => x.MerchantId == a.MerchantId).OrderByDescending(x => x.CreatedAt).Take(100).Select(x => new { x.Id, x.Kind, x.State, x.Attempts, x.CreatedAt, x.AvailableAt, x.Error }).ToListAsync() });
        if (resource == "health")
        {
            var runs = await db.Reconciliations.Where(x => x.MerchantId == a.MerchantId).OrderByDescending(x => x.CreatedAt).Take(30).ToListAsync();
            return Results.Ok(new { items = runs, stuckSagas = await db.Orders.CountAsync(x => x.MerchantId == a.MerchantId && x.Attempts >= 12), pendingRefunds = await db.Refunds.CountAsync(x => x.MerchantId == a.MerchantId && x.State == "pending"), deadLetters = await db.Outbox.CountAsync(x => x.MerchantId == a.MerchantId && x.State == "dead") });
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
