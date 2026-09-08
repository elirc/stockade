using Fulfil.Data;
using Fulfil.Domain;
using Microsoft.EntityFrameworkCore;
namespace Fulfil.Services;

public static class Reconciliation
{
    public static async Task<ReconciliationRun> Run(StockadeDb db, Guid merchant, CancellationToken ct = default)
    {
        var inventory = await db.Inventory.Where(x => x.MerchantId == merchant).ToListAsync(ct);
        var ledger = await db.Adjustments.Where(x => x.MerchantId == merchant).GroupBy(x => new { x.ProductId, x.WarehouseId }).Select(g => new { g.Key.ProductId, g.Key.WarehouseId, Quantity = g.Sum(x => x.Quantity) }).ToListAsync(ct);
        var reservations = await db.Reservations.Where(x => x.MerchantId == merchant && (x.State == "reserved" || x.State == "held")).ToListAsync(ct);
        var transfers = await db.Transfers.Where(x => x.MerchantId == merchant && x.State == "approved").ToListAsync(ct);
        var differences = new List<object>();
        foreach (var stock in inventory)
        {
            var onHand = ledger.Where(x => x.ProductId == stock.ProductId && x.WarehouseId == stock.WarehouseId).Sum(x => x.Quantity);
            var reserved = reservations.Where(x => x.ProductId == stock.ProductId && x.WarehouseId == stock.WarehouseId && x.State == "reserved").Sum(x => x.Quantity);
            var held = reservations.Where(x => x.ProductId == stock.ProductId && x.WarehouseId == stock.WarehouseId && x.State == "held").Sum(x => x.Quantity - x.Fulfilled)
                + transfers.Where(x => x.SourceId == stock.WarehouseId).SelectMany(x => Json.Read<List<QuantityLine>>(x.LinesJson)).Where(x => x.ProductId == stock.ProductId).Sum(x => x.Quantity);
            if (stock.OnHand != onHand || stock.Reserved != reserved || stock.Held != held) differences.Add(new { stock.ProductId, stock.WarehouseId, expected = new { onHand, reserved, held }, actual = new { stock.OnHand, stock.Reserved, stock.Held } });
        }
        var movements = await db.Transfers.Where(x => x.MerchantId == merchant && x.State != "draft" && x.State != "approved" && x.State != "cancelled").ToListAsync(ct);
        foreach (var movement in movements)
        {
            var original = Json.Read<List<QuantityLine>>(movement.LinesJson);
            var received = Json.Read<List<QuantityLine>>(movement.ReceivedJson);
            var lost = Json.Read<List<QuantityLine>>(movement.LostJson);
            var adjustments = await db.Adjustments.Where(x => x.MerchantId == merchant && x.Reference == movement.Id.ToString()).ToListAsync(ct);
            foreach (var line in original)
            {
                var arrived = received.Where(x => x.ProductId == line.ProductId).Sum(x => x.Quantity);
                var writtenOff = lost.Where(x => x.ProductId == line.ProductId).Sum(x => x.Quantity);
                var dispatched = -adjustments.Where(x => x.ProductId == line.ProductId && x.WarehouseId == movement.SourceId && x.Reason == "Transfer dispatched").Sum(x => x.Quantity);
                var receivedLedger = adjustments.Where(x => x.ProductId == line.ProductId && x.WarehouseId == movement.DestinationId && x.Reason == "Transfer received").Sum(x => x.Quantity);
                if (dispatched != line.Quantity || receivedLedger != arrived || arrived + writtenOff > line.Quantity || ((movement.State == "received" || movement.State == "resolved") && arrived + writtenOff != line.Quantity))
                    differences.Add(new { transferId = movement.Id, line.ProductId, original = line.Quantity, arrived, writtenOff, dispatched, receivedLedger, transit = line.Quantity - arrived - writtenOff });
            }
        }
        var run = new ReconciliationRun { MerchantId = merchant, Differences = differences.Count, DetailJson = Json.Write(differences) };
        db.Reconciliations.Add(run); return run;
    }
}
