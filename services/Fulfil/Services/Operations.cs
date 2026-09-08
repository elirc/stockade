using Fulfil.Data;
using Fulfil.Domain;
using Microsoft.EntityFrameworkCore;
using System.Text.Json.Nodes;
namespace Fulfil.Services;

public sealed partial class Commerce
{
    async Task<object> CreateTransfer(StockadeDb db, Actor a, JsonObject p)
    {
        Admin(a); var source = await Get<Warehouse>(db, a, p.Id("sourceId")); var destination = await Get<Warehouse>(db, a, p.Id("destinationId"));
        if (source.Id == destination.Id || !source.Active || !destination.Active) throw new DomainError("warehouse_invalid", "Choose two different active warehouses.");
        var lines = p.List<QuantityLine>("lines"); Rules.PositiveLines(lines);
        foreach (var line in lines) { await Stock(db, a, line.ProductId, source.Id); await Stock(db, a, line.ProductId, destination.Id); }
        var transfer = new Transfer { OwnerId = a.Id, NextAction = "Approve request", MerchantId = a.MerchantId, SourceId = source.Id, DestinationId = destination.Id, Number = Number("TR"), LinesJson = Json.Write(lines), Reason = p.Required("reason") };
        db.Transfers.Add(transfer); return transfer;
    }
    async Task<object> ApproveTransfer(StockadeDb db, Actor a, JsonObject p)
    {
        Admin(a); var transfer = await Get<Transfer>(db, a, p.Id("id"));
        if (transfer.State != "draft") throw new DomainError("invalid_state", "Only draft transfers can be approved.", 409);
        foreach (var line in Json.Read<List<QuantityLine>>(transfer.LinesJson).OrderBy(x => x.ProductId))
        { var stock = await Stock(db, a, line.ProductId, transfer.SourceId); if (stock.Available < line.Quantity) throw new DomainError("out_of_stock", "Transfer would consume committed stock.", 409); stock.Held += line.Quantity; stock.Version++; }
        transfer.State = "approved"; transfer.NextAction = "Dispatch source stock"; return transfer;
    }
    async Task<object> DispatchTransfer(StockadeDb db, Actor a, JsonObject p)
    {
        Operations(a); var transfer = await Get<Transfer>(db, a, p.Id("id")); a.Warehouse(transfer.SourceId);
        if (transfer.State != "approved") throw new DomainError("invalid_state", "Only approved transfers can be dispatched.", 409);
        foreach (var line in Json.Read<List<QuantityLine>>(transfer.LinesJson).OrderBy(x => x.ProductId))
        { var stock = await Stock(db, a, line.ProductId, transfer.SourceId); stock.Held -= line.Quantity; Move(db, a, stock, -line.Quantity, "Transfer dispatched", transfer.Id.ToString()); }
        transfer.State = "in_transit"; transfer.NextAction = "Receive at destination or investigate transit"; return transfer;
    }
    static List<QuantityLine> Combine(List<QuantityLine> a, List<QuantityLine> b) => a.Concat(b).GroupBy(x => x.ProductId).Select(g => new QuantityLine(g.Key, g.Sum(x => x.Quantity))).ToList();
    static void ValidateOutstanding(List<QuantityLine> original, List<QuantityLine> settled, List<QuantityLine> incoming)
    {
        Rules.PositiveLines(incoming);
        foreach (var line in incoming)
        {
            var outstanding = original.Where(x => x.ProductId == line.ProductId).Sum(x => x.Quantity) - settled.Where(x => x.ProductId == line.ProductId).Sum(x => x.Quantity);
            if (line.Quantity > outstanding) throw new DomainError("receipt_quantity", "Quantity exceeds the outstanding balance.", 409);
        }
    }
    async Task<object> ReceiveTransfer(StockadeDb db, Actor a, JsonObject p)
    {
        Operations(a); var transfer = await Get<Transfer>(db, a, p.Id("id")); a.Warehouse(transfer.DestinationId);
        if (transfer.State is not ("in_transit" or "partially_received")) throw new DomainError("invalid_state", "This transfer has no outstanding shipment.", 409);
        var original = Json.Read<List<QuantityLine>>(transfer.LinesJson); var received = Json.Read<List<QuantityLine>>(transfer.ReceivedJson); var lost = Json.Read<List<QuantityLine>>(transfer.LostJson); var lines = p.List<QuantityLine>("lines");
        ValidateOutstanding(original, Combine(received, lost), lines);
        foreach (var line in lines.OrderBy(x => x.ProductId)) { var stock = await Stock(db, a, line.ProductId, transfer.DestinationId); Move(db, a, stock, line.Quantity, "Transfer received", transfer.Id.ToString()); }
        received = Combine(received, lines); transfer.ReceivedJson = Json.Write(received);
        transfer.State = received.Sum(x => x.Quantity) + lost.Sum(x => x.Quantity) == original.Sum(x => x.Quantity) ? "received" : "partially_received";
        return transfer;
    }
    async Task<object> CancelTransfer(StockadeDb db, Actor a, JsonObject p)
    {
        Admin(a); var transfer = await Get<Transfer>(db, a, p.Id("id"));
        if (transfer.State is not ("draft" or "approved")) throw new DomainError("invalid_state", "Dispatched stock must be received, returned through a new transfer, or resolved as a loss.", 409);
        if (transfer.State == "approved") foreach (var line in Json.Read<List<QuantityLine>>(transfer.LinesJson)) { var stock = await Stock(db, a, line.ProductId, transfer.SourceId); stock.Held -= line.Quantity; stock.Version++; }
        transfer.State = "cancelled"; transfer.Reason = p.Required("reason"); return transfer;
    }
    async Task<object> TransferLoss(StockadeDb db, Actor a, JsonObject p)
    {
        Admin(a); var transfer = await Get<Transfer>(db, a, p.Id("id"));
        if (transfer.State is not ("in_transit" or "partially_received")) throw new DomainError("invalid_state", "Only in-transit stock can be recorded lost.", 409);
        var original = Json.Read<List<QuantityLine>>(transfer.LinesJson); var received = Json.Read<List<QuantityLine>>(transfer.ReceivedJson); var lost = Json.Read<List<QuantityLine>>(transfer.LostJson); var lines = p.List<QuantityLine>("lines");
        ValidateOutstanding(original, Combine(received, lost), lines);
        var reason = p.Required("reason");
        foreach (var line in lines) { var stock = await Stock(db, a, line.ProductId, transfer.SourceId); Move(db, a, stock, 0, $"Transit loss: {line.Quantity} units. {reason}", transfer.Id.ToString()); }
        lost = Combine(lost, lines); transfer.LostJson = Json.Write(lost); transfer.Reason = reason;
        transfer.State = received.Sum(x => x.Quantity) + lost.Sum(x => x.Quantity) == original.Sum(x => x.Quantity) ? "resolved" : "partially_received"; return transfer;
    }
    async Task<object> CreateSupplier(StockadeDb db, Actor a, JsonObject p)
    { Admin(a); var supplier = new Supplier { MerchantId = a.MerchantId, Name = p.Required("name", 150), Email = p.Required("email", 200), LeadDays = p.Int("leadDays", 7) }; if (supplier.LeadDays < 0 || supplier.LeadDays > 365) throw new DomainError("validation", "Lead time must be 0?365 days."); db.Suppliers.Add(supplier); return supplier; }
    async Task<object> CreatePurchase(StockadeDb db, Actor a, JsonObject p)
    {
        Admin(a); var supplier = await Get<Supplier>(db, a, p.Id("supplierId")); var warehouse = await Get<Warehouse>(db, a, p.Id("warehouseId")); var lines = p.List<PurchaseLine>("lines");
        Rules.PositiveLines(lines.Select(x => new QuantityLine(x.ProductId, x.Quantity)).ToList());
        foreach (var line in lines) { if (line.UnitCost < 0 || line.UnitCost > 10000000) throw new DomainError("validation", "Unit cost is invalid."); await Stock(db, a, line.ProductId, warehouse.Id); }
        var purchase = new PurchaseOrder { MerchantId = a.MerchantId, SupplierId = supplier.Id, WarehouseId = warehouse.Id, Number = Number("PO"), LinesJson = Json.Write(lines) }; db.PurchaseOrders.Add(purchase); return purchase;
    }
    async Task<object> ApprovePurchase(StockadeDb db, Actor a, JsonObject p)
    { Admin(a); var purchase = await Get<PurchaseOrder>(db, a, p.Id("id")); if (purchase.State != "draft") throw new DomainError("invalid_state", "Only draft purchases can be approved.", 409); purchase.State = "approved"; purchase.ApprovedBy = a.Id; return purchase; }
    async Task<object> ReceivePurchase(StockadeDb db, Actor a, JsonObject p)
    {
        Operations(a); var purchase = await Get<PurchaseOrder>(db, a, p.Id("id")); a.Warehouse(purchase.WarehouseId);
        if (purchase.State is not ("approved" or "partially_received")) throw new DomainError("invalid_state", "Only open approved purchases can be received.", 409);
        var original = Json.Read<List<PurchaseLine>>(purchase.LinesJson).Select(x => new QuantityLine(x.ProductId, x.Quantity)).ToList(); var received = Json.Read<List<QuantityLine>>(purchase.ReceivedJson); var lines = p.List<QuantityLine>("lines"); ValidateOutstanding(original, received, lines);
        var receipt = new GoodsReceipt { MerchantId = a.MerchantId, PurchaseOrderId = purchase.Id, LinesJson = Json.Write(lines) };
        foreach (var line in lines.OrderBy(x => x.ProductId)) { var stock = await Stock(db, a, line.ProductId, purchase.WarehouseId); Move(db, a, stock, line.Quantity, "Supplier receipt", receipt.Id.ToString()); }
        received = Combine(received, lines); purchase.ReceivedJson = Json.Write(received); purchase.State = received.Sum(x => x.Quantity) == original.Sum(x => x.Quantity) ? "received" : "partially_received"; db.GoodsReceipts.Add(receipt); return new { purchase, receipt };
    }
    async Task<object> CancelPurchase(StockadeDb db, Actor a, JsonObject p)
    { Admin(a); var purchase = await Get<PurchaseOrder>(db, a, p.Id("id")); if (purchase.State is "received" or "cancelled") throw new DomainError("invalid_state", "This purchase is already closed.", 409); purchase.Exception = p.Required("reason"); purchase.State = "cancelled"; return purchase; }
    async Task<object> CreateCount(StockadeDb db, Actor a, JsonObject p)
    { Operations(a); var stock = await Stock(db, a, p.Id("productId"), p.Id("warehouseId")); if (await db.CycleCounts.AnyAsync(x => x.MerchantId == a.MerchantId && x.ProductId == stock.ProductId && x.WarehouseId == stock.WarehouseId && (x.State == "open" || x.State == "submitted"))) throw new DomainError("count_open", "A count is already open for this position.", 409); var count = new CycleCount { MerchantId = a.MerchantId, WarehouseId = stock.WarehouseId, ProductId = stock.ProductId, Expected = stock.OnHand, InventoryVersion = stock.Version, CreatedBy = a.Id, AssignedTo = a.Id }; if (Guid.TryParse(p.Text("assignedTo"), out var assignee)) { Admin(a); var member = await Get<Account>(db, a, assignee); if (member.Role is not ("owner" or "admin" or "warehouse") || member.WarehouseId != null && member.WarehouseId != stock.WarehouseId) throw new DomainError("assignment", "Choose an operator with access to this warehouse."); count.AssignedTo = assignee; } db.CycleCounts.Add(count); return count; }
    async Task<object> SubmitCount(StockadeDb db, Actor a, JsonObject p)
    {
        Operations(a); var count = await Get<CycleCount>(db, a, p.Id("id")); a.Warehouse(count.WarehouseId);
        if (count.State != "open") throw new DomainError("invalid_state", "Only open counts can be submitted.", 409);
        if (a.Role == "warehouse" && count.AssignedTo != a.Id) throw new DomainError("assignment", "This count is assigned to another operator.", 403);
        var counted = p.Int("counted", -1); if (counted < 0 || counted > 1000000) throw new DomainError("validation", "Count must be between 0 and 1,000,000.");
        var stock = await Stock(db, a, count.ProductId, count.WarehouseId);
        if (stock.Version != count.InventoryVersion) throw new DomainError("stale_count", "Stock changed after this count started. Reject this session and create a fresh count.", 409);
        count.Counted = counted; count.ObservedAt = DateTime.UtcNow; count.Reason = p.Required("reason"); count.State = "submitted"; return count;
    }
    async Task<object> ApproveCount(StockadeDb db, Actor a, JsonObject p)
    {
        Admin(a); var count = await Get<CycleCount>(db, a, p.Id("id"));
        if (count.State != "submitted" || count.Counted == null) throw new DomainError("invalid_state", "Submit the count before approval.", 409);
        if (count.CreatedBy == a.Id || count.AssignedTo == a.Id) throw new DomainError("independent_approval", "A different administrator must approve this inventory correction.", 403);
        var stock = await Stock(db, a, count.ProductId, count.WarehouseId);
        if (stock.Version != count.InventoryVersion) throw new DomainError("stale_count", "Stock changed before approval. Reject and recount.", 409);
        if (count.Counted < stock.Reserved + stock.Held) throw new DomainError("shortage", "The count is below committed stock. Resolve allocations before correcting inventory.", 409);
        Move(db, a, stock, count.Counted.Value - stock.OnHand, "Cycle count: " + count.Reason, count.Id.ToString()); count.State = "approved"; count.ApprovedBy = a.Id; return count;
    }
    async Task<object> RejectCount(StockadeDb db, Actor a, JsonObject p)
    { Operations(a); var count = await Get<CycleCount>(db, a, p.Id("id")); a.Warehouse(count.WarehouseId); if (count.State is "approved" or "rejected") throw new DomainError("invalid_state", "This count is closed.", 409); count.State = "rejected"; count.Reason = p.Required("reason"); return count; }
    async Task<object> SetTransferException(StockadeDb db, Actor a, JsonObject p)
    {
        Admin(a); var transfer = await Get<Transfer>(db, a, p.Id("id"));
        var owner = await Get<Account>(db, a, p.Id("ownerId")); if (owner.Role is not ("owner" or "admin")) throw new DomainError("owner", "Choose an inventory administrator.");
        transfer.OwnerId = owner.Id; transfer.NextAction = p.Required("nextAction"); return transfer;
    }
    async Task<object> RejectGoods(StockadeDb db, Actor a, JsonObject p)
    {
        Operations(a); var po = await Get<PurchaseOrder>(db, a, p.Id("id")); a.Warehouse(po.WarehouseId);
        if (po.State is not ("approved" or "partially_received")) throw new DomainError("invalid_state", "Only open purchases accept receiving exceptions.", 409);
        var lines = p.List<QuantityLine>("lines");
        ValidateOutstanding(Json.Read<List<PurchaseLine>>(po.LinesJson).Select(x => new QuantityLine(x.ProductId, x.Quantity)).ToList(), Json.Read<List<QuantityLine>>(po.ReceivedJson), lines);
        var reason = p.Required("reason"); var receipt = new GoodsReceipt { MerchantId = a.MerchantId, PurchaseOrderId = po.Id, Disposition = "rejected", Reason = reason, LinesJson = Json.Write(lines) };
        db.GoodsReceipts.Add(receipt); po.Exception = reason; return receipt;
    }
}
