using Fulfil.Data;
using Fulfil.Domain;
using Microsoft.EntityFrameworkCore;
using System.Text.Json.Nodes;
namespace Fulfil.Services;

public sealed partial class Commerce(Transactions transactions)
{
    public Task<JsonNode> Execute(Actor actor, string operation, string key, JsonObject input, CancellationToken ct = default)
        => transactions.Command(actor, key, operation, input, db => Dispatch(db, actor, operation, input), ct);

    async Task<object> Dispatch(StockadeDb db, Actor a, string op, JsonObject p) => op switch
    {
        "team.create" => await CreateMember(db, a, p),
        "payment.retry" => await RetryPayment(db, a, p),
        "refund.retry" => await RetryRefund(db, a, p),
        "checkout" => await Checkout(db, a, p),
        "inventory.initialize" => await InitializeInventory(db, a, p),
        "order.cancel" => await Cancel(db, a, p),
        "order.fulfill" => await Ship(db, a, p),
        "order.refund" => await RefundOrder(db, a, p),
        "order.reallocate" => await Reallocate(db, a, p),
        "return.request" => await RequestReturn(db, a, p),
        "return.decide" => await DecideReturn(db, a, p),
        "return.receive" => await ReceiveReturn(db, a, p),
        "exchange.checkout" => p["expectedTotal"] == null ? throw new DomainError("quote_required", "Review the replacement total before confirming.") : await PayExchange(db, a, p),
        "inventory.adjust" => await Adjust(db, a, p),
        "inventory.policy" => await Policy(db, a, p),
        "warehouse.update" => await UpdateWarehouse(db, a, p),
        "promotion.create" => await CreatePromotion(db, a, p),
        "promotion.toggle" => await TogglePromotion(db, a, p),
        "transfer.exception" => await SetTransferException(db, a, p),
        "purchase.reject" => await RejectGoods(db, a, p),
        "transfer.create" => await CreateTransfer(db, a, p),
        "transfer.approve" => await ApproveTransfer(db, a, p),
        "transfer.dispatch" => await DispatchTransfer(db, a, p),
        "transfer.receive" => await ReceiveTransfer(db, a, p),
        "transfer.cancel" => await CancelTransfer(db, a, p),
        "transfer.loss" => await TransferLoss(db, a, p),
        "purchase.create" => await CreatePurchase(db, a, p),
        "purchase.approve" => await ApprovePurchase(db, a, p),
        "purchase.receive" => await ReceivePurchase(db, a, p),
        "purchase.cancel" => await CancelPurchase(db, a, p),
        "supplier.create" => await CreateSupplier(db, a, p),
        "count.create" => await CreateCount(db, a, p),
        "count.submit" => await SubmitCount(db, a, p),
        "count.approve" => await ApproveCount(db, a, p),
        "count.reject" => await RejectCount(db, a, p),
        "outbox.retry" => await RetryEvent(db, a, p),
        "tax.update" => await UpdateTax(db, a, p),
        _ => throw new DomainError("unknown_command", "Unknown command.", 404)
    };
    static void Admin(Actor a) => a.Demand("owner", "admin");
    static void Operations(Actor a) => a.Demand("owner", "admin", "warehouse");
    static async Task<T> Get<T>(StockadeDb db, Actor a, Guid id) where T : Record
        => await db.Set<T>().SingleOrDefaultAsync(x => x.Id == id && x.MerchantId == a.MerchantId) ?? throw new DomainError("not_found", "Record not found.", 404);
    static async Task<Order> VisibleOrder(StockadeDb db, Actor a, Guid id)
    {
        var order = await Get<Order>(db, a, id);
        if (a.Role == "customer" && order.CustomerId != a.Id) throw new DomainError("not_found", "Order not found.", 404);
        if (a.Role == "warehouse") throw new DomainError("forbidden", "Use warehouse fulfillment access.", 403);
        return order;
    }
    static async Task<Inventory> Stock(StockadeDb db, Actor a, Guid product, Guid warehouse)
    {
        a.Warehouse(warehouse);
        return await db.Inventory.SingleOrDefaultAsync(x => x.MerchantId == a.MerchantId && x.ProductId == product && x.WarehouseId == warehouse)
            ?? throw new DomainError("inventory_missing", "This product is not stocked at the selected warehouse.");
    }
    static void Move(StockadeDb db, Actor a, Inventory stock, int delta, string reason, string reference)
    {
        if (stock.Available + delta < 0) throw new DomainError("stock_committed", "This change would consume committed stock. Resolve the shortage first.", 409);
        stock.OnHand = checked(stock.OnHand + delta); stock.Version++;
        db.Adjustments.Add(new Adjustment { MerchantId = a.MerchantId, ActorId = a.Id, ProductId = stock.ProductId, WarehouseId = stock.WarehouseId, Quantity = delta, Reason = reason, Reference = reference });
    }
    static void Event(StockadeDb db, Order order, string kind, string detail)
    {
        db.OrderEvents.Add(new OrderEvent { MerchantId = order.MerchantId, OrderId = order.Id, Kind = kind, Detail = detail });
        db.Outbox.Add(new OutboxEvent { MerchantId = order.MerchantId, Kind = "order." + kind, Payload = Json.Write(new { orderId = order.Id, number = order.Number, email = order.Email, state = order.State, detail }) });
    }
    static string Number(string prefix) => prefix + "-" + DateTime.UtcNow.ToString("yyMMdd") + "-" + Guid.NewGuid().ToString("N")[..6].ToUpperInvariant();

    public Task<object> Preview(StockadeDb db, Actor a, JsonObject input) => Checkout(db, a, input);
    async Task<object> InitializeInventory(StockadeDb db, Actor a, JsonObject p)
    { Admin(a); var product = await Get<Product>(db, a, p.Id("productId")); var warehouses = await db.Warehouses.Where(x => x.MerchantId == a.MerchantId).ToListAsync(); foreach (var wh in warehouses) if (!await db.Inventory.AnyAsync(x => x.ProductId == product.Id && x.WarehouseId == wh.Id && x.MerchantId == a.MerchantId)) db.Inventory.Add(new Inventory { MerchantId = a.MerchantId, ProductId = product.Id, WarehouseId = wh.Id }); return new { product.Id }; }
    async Task<object> Checkout(StockadeDb db, Actor a, JsonObject p)
    {
        var account = await Get<Account>(db, a, a.Id);
        var requested = p.List<QuantityLine>("lines"); Rules.PositiveLines(requested);
        var products = await db.Products.Where(x => x.MerchantId == a.MerchantId && x.Active && requested.Select(q => q.ProductId).Contains(x.Id)).ToListAsync();
        if (products.Count != requested.Count) throw new DomainError("product_unavailable", "A selected product is unavailable.");
        var lines = requested.Select(q => { var product = products.Single(x => x.Id == q.ProductId); return new OrderLine(product.Id, product.Sku, product.Name, product.Variant, q.Quantity, product.Price, 0, 0); }).ToList();
        var subtotal = lines.Sum(x => checked(x.Quantity * x.UnitPrice));
        if (subtotal > 10_000_000) throw new DomainError("order_limit", "This order exceeds the supported order amount.");
        var pricing = await Price(db, a, lines, p); lines = pricing.Lines; var promotion = pricing.Promotions.FirstOrDefault();
        var discount = lines.Sum(x => x.Discount);
        var rate = await db.TaxRates.Where(x => x.MerchantId == a.MerchantId && x.Active).SumAsync(x => x.BasisPoints);
        lines = lines.Select(line => line with { Tax = Rules.Tax(line.Quantity * line.UnitPrice - line.Discount, rate) }).ToList();
        var warehouses = await db.Warehouses.Where(x => x.MerchantId == a.MerchantId && x.Active).OrderBy(x => x.Priority).ThenBy(x => x.ShippingCost).ThenBy(x => x.Id).ToListAsync();
        var order = new Order { MerchantId = a.MerchantId, CustomerId = a.Id, Email = account.Guest ? account.Name : account.Email, Address = p.Required("address", 1000), Number = Number("ST"), CheckoutKey = p.Required("checkoutKey", 150), PaymentMethod = p.Text("paymentMethod", "sim_success"), Subtotal = subtotal, Discount = discount, Tax = lines.Sum(x => x.Tax), LinesJson = Json.Write(lines), TaxJson = Json.Write(new[] { new { name = "Sales tax", basisPoints = rate, amount = lines.Sum(x => x.Tax) } }), PromotionId = promotion?.Id, PromotionsJson = Json.Write(pricing.Promotions.Select(x => new { x.Id, x.Code, x.Kind, x.Value, x.Segment, x.Priority, x.Stackable, x.ProductId, x.Minimum, x.RuleVersion, x.ExclusionsJson })) };
        var positions = await db.Inventory.Where(x => x.MerchantId == a.MerchantId && products.Select(p => p.Id).Contains(x.ProductId) && warehouses.Select(w => w.Id).Contains(x.WarehouseId)).ToListAsync();
        var used = new HashSet<Guid>();
        foreach (var line in lines.OrderBy(x => x.ProductId))
        {
            var remaining = line.Quantity;
            foreach (var warehouse in warehouses)
            {
                var stock = positions.SingleOrDefault(x => x.ProductId == line.ProductId && x.WarehouseId == warehouse.Id);
                var quantity = Math.Min(remaining, stock?.Available ?? 0);
                if (quantity <= 0) continue;
                stock!.Reserved += quantity; stock.Version++; used.Add(warehouse.Id);
                db.Reservations.Add(new Reservation { MerchantId = a.MerchantId, OrderId = order.Id, ProductId = line.ProductId, WarehouseId = warehouse.Id, Quantity = quantity });
                remaining -= quantity; if (remaining == 0) break;
            }
            if (remaining > 0) throw new DomainError("out_of_stock", $"Not enough stock for {line.Name}.", 409);
        }
        order.Shipping = pricing.Promotions.Any(x => x.Kind == "shipping") ? 0 : warehouses.Where(x => used.Contains(x.Id)).Sum(x => x.ShippingCost);
        order.Total = checked(subtotal - discount + order.Shipping + order.Tax);
        if (order.Total == 0) throw new DomainError("zero_order", "An order must have a positive total.");
        if (p.Money("expectedTotal", order.Total) != order.Total) throw new DomainError("price_changed", "Your total changed. Review the updated quote before confirming.", 409);
        db.Orders.Add(order);
        foreach (var applied in pricing.Promotions) db.PromotionUsages.Add(new PromotionUsage { MerchantId = a.MerchantId, PromotionId = applied.Id, CustomerId = a.Id, OrderId = order.Id });
        Event(db, order, "reserved", "Stock reserved; payment is pending.");
        return new { id = order.Id, order.Number, order.Total, state = order.State, order.Subtotal, order.Discount, order.Shipping, order.Tax };
    }
    async Task<object> Cancel(StockadeDb db, Actor a, JsonObject p)
    {
        var order = await VisibleOrder(db, a, p.Id("id"));
        if (order.FulfillmentState != "unfulfilled") throw new DomainError("already_shipped", "Use returns for shipped items.", 409);
        if (order.PaymentState is "authorizing" or "capturing" or "unknown" or "refunding")
            throw new DomainError("payment_pending", "Reconcile the in-flight payment before cancellation.", 409);
        if (order.State is "cancelled" or "closed" or "payment_failed") throw new DomainError("invalid_transition", "This order is already terminal.", 409);
        if (order.ProviderId != null && order.Captured == 0 && order.PaymentState != "voided")
        {
            order.PaymentState = "void_pending"; order.Error = "Cancellation requested.";
            Event(db, order, "cancel_requested", "Payment authorization will be voided before stock is released.");
            return new { order.Id, state = "cancelling" };
        }
        await Release(db, order);
        if (order.Captured > order.Refunded + order.RefundPending)
            ReserveRefund(db, order, order.Captured - order.Refunded - order.RefundPending, p.Required("reason"), null);
        Rules.Transition(order, "cancelled");
        Event(db, order, "cancelled", "Order cancelled; any captured payment is queued for refund.");
        return new { order.Id, order.State };
    }
    public static async Task Release(StockadeDb db, Order order)
    {
        var reservations = await db.Reservations.Where(x => x.OrderId == order.Id && x.State != "released" && x.State != "fulfilled").ToListAsync();
        foreach (var r in reservations)
        {
            var stock = await db.Inventory.SingleAsync(x => x.MerchantId == order.MerchantId && x.ProductId == r.ProductId && x.WarehouseId == r.WarehouseId);
            if (r.State == "reserved") stock.Reserved -= r.Quantity;
            else if (r.State == "held") stock.Held -= r.Quantity - r.Fulfilled;
            stock.Version++; r.State = "released";
        }
    }
    async Task<object> Ship(StockadeDb db, Actor a, JsonObject p)
    {
        Operations(a);
        var order = await Get<Order>(db, a, p.Id("id"));
        var warehouse = p.Id("warehouseId"); a.Warehouse(warehouse);
        if (order.Captured < order.Total || order.State is "cancelled" or "closed") throw new DomainError("not_paid", "Only paid active orders may be fulfilled.", 409);
        var wh = await Get<Warehouse>(db, a, warehouse);
        if (!wh.Active) throw new DomainError("warehouse_offline", "Reallocate this order before shipping.", 409);
        var lines = p.List<QuantityLine>("lines"); Rules.PositiveLines(lines);
        var fulfillment = new Fulfillment { MerchantId = a.MerchantId, OrderId = order.Id, WarehouseId = warehouse, LinesJson = Json.Write(lines), Carrier = p.Required("carrier", 100), Tracking = p.Required("tracking", 150) };
        foreach (var line in lines.OrderBy(x => x.ProductId))
        {
            var rows = await db.Reservations.Where(x => x.OrderId == order.Id && x.WarehouseId == warehouse && x.ProductId == line.ProductId && x.State == "held").ToListAsync();
            if (rows.Sum(x => x.Quantity - x.Fulfilled) < line.Quantity) throw new DomainError("fulfillment_quantity", "Quantity exceeds allocated unshipped stock.");
            var stock = await Stock(db, a, line.ProductId, warehouse);
            var remaining = line.Quantity;
            foreach (var row in rows)
            {
                var q = Math.Min(remaining, row.Quantity - row.Fulfilled); row.Fulfilled += q; remaining -= q;
                if (row.Quantity == row.Fulfilled) row.State = "fulfilled";
            }
            stock.Held -= line.Quantity;
            Move(db, a, stock, -line.Quantity, "Shipment", fulfillment.Id.ToString());
        }
        db.Fulfillments.Add(fulfillment);
        await db.SaveChangesAsync();
        var pending = await db.Reservations.AnyAsync(x => x.OrderId == order.Id && x.State == "held" && x.Fulfilled < x.Quantity);
        var target = pending ? "partially_fulfilled" : "fulfilled";
        if (order.State != target) Rules.Transition(order, target);
        order.FulfillmentState = target;
        Event(db, order, "shipped", $"{fulfillment.Carrier}: {fulfillment.Tracking}");
        return fulfillment;
    }
    internal static Refund ReserveRefund(StockadeDb db, Order order, long amount, string reason, Guid? returnId)
    {
        if (amount <= 0 || amount > order.Captured - order.Refunded - order.RefundPending) throw new DomainError("refund_limit", "Refund exceeds remaining captured funds.");
        var refund = new Refund { MerchantId = order.MerchantId, OrderId = order.Id, Amount = amount, Reason = reason, ReturnId = returnId };
        db.Refunds.Add(refund); order.RefundPending += amount;
        Event(db, order, "refund_requested", $"Refund of {amount} minor units queued.");
        return refund;
    }
    async Task<object> RefundOrder(StockadeDb db, Actor a, JsonObject p)
    { a.Demand("owner", "admin", "support"); var order = await VisibleOrder(db, a, p.Id("id")); return ReserveRefund(db, order, p.Money("amount"), p.Required("reason"), null); }

    async Task<object> Reallocate(StockadeDb db, Actor a, JsonObject p)
    {
        Admin(a); var order = await Get<Order>(db, a, p.Id("id"));
        if (order.PaymentState != "captured" || order.State is "closed" or "cancelled") throw new DomainError("invalid_state", "Only captured active allocations can be reassigned.", 409);
        var reservations = await db.Reservations.Where(x => x.OrderId == order.Id && x.State == "held").ToListAsync();
        var warehouses = await db.Warehouses.Where(x => x.MerchantId == a.MerchantId && x.Active).OrderBy(x => x.Priority).ThenBy(x => x.Id).ToListAsync();
        foreach (var r in reservations)
        {
            var old = await Stock(db, a, r.ProductId, r.WarehouseId);
            if (warehouses.Any(x => x.Id == r.WarehouseId)) continue;
            var remaining = r.Quantity - r.Fulfilled;
            old.Held -= remaining; old.Version++; r.State = "released";
            foreach (var wh in warehouses)
            {
                var stock = await Stock(db, a, r.ProductId, wh.Id); var q = Math.Min(remaining, stock.Available);
                if (q == 0) continue;
                stock.Held += q; stock.Version++;
                db.Reservations.Add(new Reservation { MerchantId = a.MerchantId, OrderId = order.Id, ProductId = r.ProductId, WarehouseId = wh.Id, Quantity = q, State = "held" });
                remaining -= q; if (remaining == 0) break;
            }
            if (remaining > 0) throw new DomainError("reallocation_shortage", "Insufficient replacement stock. Existing allocations were preserved.", 409);
        }
        Event(db, order, "reallocated", "Offline warehouse allocations reassigned.");
        return new { order.Id, order.State };
    }
    async Task<object> RequestReturn(StockadeDb db, Actor a, JsonObject p)
    {
        var order = await VisibleOrder(db, a, p.Id("orderId"));
        if (order.CreatedAt < DateTime.UtcNow.AddDays(-30)) throw new DomainError("return_window", "The 30-day return window has closed.");
        var lines = p.List<QuantityLine>("lines"); Rules.PositiveLines(lines);
        var shipments = await db.Fulfillments.Where(x => x.OrderId == order.Id).ToListAsync();
        var claimed = await db.Returns.Where(x => x.OrderId == order.Id && x.State != "rejected").ToListAsync();
        foreach (var line in lines)
        {
            var shipped = shipments.SelectMany(x => Json.Read<List<QuantityLine>>(x.LinesJson)).Where(x => x.ProductId == line.ProductId).Sum(x => x.Quantity);
            var pending = claimed.SelectMany(x => Json.Read<List<QuantityLine>>(x.LinesJson)).Where(x => x.ProductId == line.ProductId).Sum(x => x.Quantity);
            if (line.Quantity > shipped - pending) throw new DomainError("return_quantity", "Requested quantity exceeds the remaining returnable quantity.");
        }
        Guid? replacement = Guid.TryParse(p.Text("replacementProductId"), out var rp) ? rp : null;
        if (replacement != null) { await Get<Product>(db, a, replacement.Value); if (lines.Count != 1) throw new DomainError("exchange_lines", "Submit one original variant per exchange request."); }
        var request = new ReturnRequest { MerchantId = a.MerchantId, OrderId = order.Id, CustomerId = order.CustomerId, LinesJson = Json.Write(lines), Reason = p.Required("reason"), ReplacementProductId = replacement };
        db.Returns.Add(request); Event(db, order, "return_requested", "A return request is ready for review.");
        return request;
    }
    async Task<object> DecideReturn(StockadeDb db, Actor a, JsonObject p)
    {
        a.Demand("owner", "admin", "support");
        var request = await Get<ReturnRequest>(db, a, p.Id("id"));
        if (request.State != "requested") throw new DomainError("invalid_state", "This request has already been reviewed.", 409);
        request.State = p.Flag("approve") ? "approved" : "rejected"; request.Decision = p.Required("reason");
        var order = await Get<Order>(db, a, request.OrderId); Event(db, order, "return_" + request.State, request.Decision);
        return request;
    }
    async Task<object> ReceiveReturn(StockadeDb db, Actor a, JsonObject p)
    {
        Operations(a); var request = await Get<ReturnRequest>(db, a, p.Id("id"));
        if (request.State != "approved") throw new DomainError("invalid_state", "Only approved, unreceived returns can be received.", 409);
        var order = await Get<Order>(db, a, request.OrderId); var warehouse = p.Id("warehouseId"); a.Warehouse(warehouse);
        var lines = Json.Read<List<QuantityLine>>(request.LinesJson); var originals = Json.Read<List<OrderLine>>(order.LinesJson);
        var prior = await db.Returns.Where(x => x.OrderId == order.Id && x.State == "received").ToListAsync();
        long refund = 0;
        foreach (var line in lines)
        {
            var old = prior.SelectMany(x => Json.Read<List<QuantityLine>>(x.LinesJson)).Where(x => x.ProductId == line.ProductId).Sum(x => x.Quantity);
            refund += Rules.ReturnValue(originals.Single(x => x.ProductId == line.ProductId), line.Quantity, old);
            if (p.Flag("restock", true)) { var stock = await Stock(db, a, line.ProductId, warehouse); Move(db, a, stock, line.Quantity, "Return received", request.Id.ToString()); }
        }
        var remaining = order.Captured - order.Refunded - order.RefundPending;
        // Prior goodwill/manual refunds reduce the remaining payable refund, never over-refund.
        if (Math.Min(refund, remaining) > 0) ReserveRefund(db, order, Math.Min(refund, remaining), "Return " + request.Id, request.Id);
        request.State = "received"; request.WarehouseId = warehouse; request.Restocked = p.Flag("restock", true);
        if (order.State != "partially_returned") Rules.Transition(order, "partially_returned");
        if (request.ReplacementProductId != null)
        {
            // Replacement is a separately confirmed purchase linked to the return. No off-session charge.
            request.Decision = (request.Decision ?? "") + " Replacement is ready for customer checkout; original items are refunded separately.";
        }
        Event(db, order, "return_received", request.Restocked ? "Received and restocked." : "Received without restock.");
        return request;
    }
    public async Task<object> PreviewExchange(StockadeDb db, Actor a, JsonObject p)
    {
        var quote = System.Text.Json.JsonSerializer.SerializeToNode(await PayExchange(db, a, p), Json.Options)!.AsObject();
        var returnId = p.Id("id"); quote["originalRefund"] = await db.Refunds.Where(x => x.MerchantId == a.MerchantId && x.ReturnId == returnId).SumAsync(x => x.Amount);
        return quote;
    }
    async Task<object> PayExchange(StockadeDb db, Actor a, JsonObject p)
    {
        var request = await Get<ReturnRequest>(db, a, p.Id("id"));
        if (request.CustomerId != a.Id) throw new DomainError("not_found", "Exchange not found.", 404);
        if (request.State != "received" || request.ReplacementProductId == null || request.ExchangeOrderId != null)
            throw new DomainError("exchange_state", "This exchange is not ready for checkout.", 409);
        var original = await Get<Order>(db, a, request.OrderId);
        var input = new JsonObject { ["lines"] = System.Text.Json.JsonSerializer.SerializeToNode(new[] { new QuantityLine(request.ReplacementProductId.Value, Json.Read<List<QuantityLine>>(request.LinesJson).Sum(x => x.Quantity)) }, Json.Options), ["address"] = original.Address, ["checkoutKey"] = "exchange:" + request.Id, ["paymentMethod"] = p.Text("paymentMethod", "sim_success") };
        if (p["expectedTotal"] != null) input["expectedTotal"] = p["expectedTotal"]!.DeepClone();
        var result = await Checkout(db, a, input);
        var id = System.Text.Json.JsonSerializer.SerializeToNode(result, Json.Options)!["id"]!.GetValue<Guid>();
        request.ExchangeOrderId = id; return result;
    }
    async Task<object> Adjust(StockadeDb db, Actor a, JsonObject p)
    { Admin(a); var stock = await Stock(db, a, p.Id("productId"), p.Id("warehouseId")); var delta = p.Int("quantity"); if (delta == 0 || Math.Abs((long)delta) > 100000) throw new DomainError("validation", "Adjustment must be nonzero and within 100,000 units."); Move(db, a, stock, delta, p.Required("reason"), Guid.NewGuid().ToString()); return stock; }
    async Task<object> Policy(StockadeDb db, Actor a, JsonObject p)
    { Admin(a); var stock = await Stock(db, a, p.Id("productId"), p.Id("warehouseId")); var point = p.Int("reorderPoint"); var target = p.Int("reorderTarget"); if (point < 0 || target <= point || target > 100000) throw new DomainError("validation", "Target must exceed a nonnegative reorder point."); stock.ReorderPoint = point; stock.ReorderTarget = target; return stock; }
    async Task<object> UpdateWarehouse(StockadeDb db, Actor a, JsonObject p)
    { Admin(a); var wh = await Get<Warehouse>(db, a, p.Id("id")); wh.Active = p.Flag("active", wh.Active); wh.Priority = p.Int("priority", wh.Priority); wh.ShippingCost = p.Money("shippingCost", wh.ShippingCost); if (wh.ShippingCost < 0 || wh.Priority < 0) throw new DomainError("validation", "Priority and cost must be nonnegative."); return wh; }
    async Task<object> CreatePromotion(StockadeDb db, Actor a, JsonObject p)
    {
        Admin(a); var kind = p.Text("kind", "percent"); var value = p.Int("value");
        if (!new[] { "percent", "fixed", "bogo", "shipping" }.Contains(kind) || value < 0 || kind == "percent" && value > 100) throw new DomainError("validation", "Invalid promotion action or value.");
        var days = p.Int("days", 30); if (days < 1 || days > 3650) throw new DomainError("duration", "Use 1 to 3650 days.");
        var promo = new Promotion { MerchantId = a.MerchantId, Code = p.Required("code", 40).ToUpperInvariant(), Kind = kind, Value = value, Minimum = p.Money("minimum"), GlobalLimit = p.Int("globalLimit", 1000), PerCustomerLimit = p.Int("perCustomerLimit", 1), EndsAt = DateTime.UtcNow.AddDays(days) };
        if (promo.GlobalLimit <= 0 || promo.PerCustomerLimit <= 0 || promo.Minimum < 0 || promo.EndsAt <= DateTime.UtcNow) throw new DomainError("validation", "Promotion limits, duration, and minimum are invalid.");
        if (Guid.TryParse(p.Text("productId"), out var product)) { await Get<Product>(db, a, product); promo.ProductId = product; }
        promo.Segment = p.Text("segment", "all"); if (promo.Segment is not ("all" or "new" or "returning")) throw new DomainError("segment", "Choose all, new or returning customers.");
        promo.Stackable = p.Flag("stackable"); promo.Priority = p.Int("priority"); if (promo.Priority < 0 || promo.Priority > 1000) throw new DomainError("priority", "Priority must be 0 to 1000.");
        promo.ExclusionsJson = Json.Write(p.Text("exclusions").Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries).Select(x => x.ToUpperInvariant()).Distinct().ToList());
        db.Promotions.Add(promo); return promo;
    }
    async Task<object> TogglePromotion(StockadeDb db, Actor a, JsonObject p) { Admin(a); var promo = await Get<Promotion>(db, a, p.Id("id")); promo.Active = p.Flag("active"); return promo; }
    async Task<object> UpdateTax(StockadeDb db, Actor a, JsonObject p)
    { Admin(a); var bps = p.Int("basisPoints"); if (bps < 0 || bps > 10000) throw new DomainError("validation", "Tax must be between 0 and 10,000 basis points."); var old = await db.TaxRates.Where(x => x.MerchantId == a.MerchantId && x.Active).ToListAsync(); old.ForEach(x => x.Active = false); var rate = new TaxRate { MerchantId = a.MerchantId, Name = p.Required("name", 100), BasisPoints = bps }; db.TaxRates.Add(rate); return rate; }
    async Task<object> RetryEvent(StockadeDb db, Actor a, JsonObject p) { Admin(a); var e = await Get<OutboxEvent>(db, a, p.Id("id")); if (e.State != "dead") throw new DomainError("invalid_state", "Only dead-letter events can be retried."); e.State = "pending"; e.Attempts = 0; e.AvailableAt = DateTime.UtcNow; return new { e.Id, e.State }; }
}
