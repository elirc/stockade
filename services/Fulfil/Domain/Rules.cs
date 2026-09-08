using System.Text.Json;
using System.Text.Json.Nodes;
namespace Fulfil.Domain;

public sealed class DomainError(string code, string message, int status = 422) : Exception(message)
{ public string Code { get; } = code; public int Status { get; } = status; }
public record Actor(Guid Id, Guid MerchantId, string Role, Guid? WarehouseId)
{
    public bool Admin => Role is "owner" or "admin" or "warehouse" or "support";
    public void Demand(params string[] roles) { if (!roles.Contains(Role)) throw new DomainError("forbidden", "Your role does not allow this action.", 403); }
    public void Warehouse(Guid id) { if (WarehouseId.HasValue && WarehouseId != id) throw new DomainError("warehouse_scope", "This warehouse is outside your access.", 403); }
}
public static class Json
{
    public static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web);
    public static string Write<T>(T value) => JsonSerializer.Serialize(value, Options);
    public static T Read<T>(string value) => JsonSerializer.Deserialize<T>(value, Options)!;
    public static string Text(this JsonObject x, string key, string fallback = "") => x[key]?.GetValue<string>()?.Trim() ?? fallback;
    public static Guid Id(this JsonObject x, string key)
        => Guid.TryParse(x.Text(key), out var id) ? id : throw new DomainError("validation", $"{key} must be a valid ID.");
    public static int Int(this JsonObject x, string key, int fallback = 0) => x[key]?.GetValue<int>() ?? fallback;
    public static long Money(this JsonObject x, string key, long fallback = 0) => x[key]?.GetValue<long>() ?? fallback;
    public static bool Flag(this JsonObject x, string key, bool fallback = false) => x[key]?.GetValue<bool>() ?? fallback;
    public static List<T> List<T>(this JsonObject x, string key) => x[key]?.Deserialize<List<T>>(Options) ?? [];
    public static string Required(this JsonObject x, string key, int max = 500)
    { var value = x.Text(key); if (value.Length == 0 || value.Length > max) throw new DomainError("validation", $"{key} is required and must be at most {max} characters."); return value; }
}
public static class Rules
{
    public static readonly IReadOnlyDictionary<string, string[]> Transitions = new Dictionary<string, string[]>
    {
        ["reserved"] = ["authorized", "action_required", "cancelled", "payment_failed"],
        ["action_required"] = ["authorized", "cancelled", "payment_failed"],
        ["authorized"] = ["placed", "cancelled", "payment_failed"],
        ["placed"] = ["paid", "cancelled", "payment_failed"],
        ["paid"] = ["partially_fulfilled", "fulfilled", "cancelled"],
        ["partially_fulfilled"] = ["fulfilled", "partially_returned", "closed"],
        ["fulfilled"] = ["partially_returned", "closed"],
        ["partially_returned"] = ["partially_fulfilled", "fulfilled", "closed"],
        ["payment_failed"] = [],
        ["cancelled"] = [],
        ["closed"] = []
    };
    public static void Transition(Order o, string target)
    {
        if (!Transitions.TryGetValue(o.State, out var allowed) || !allowed.Contains(target))
            throw new DomainError("invalid_transition", $"Cannot move an order from {o.State} to {target}.", 409);
        o.State = target; o.UpdatedAt = DateTime.UtcNow;
    }
    public static void PositiveLines(List<QuantityLine> lines)
    {
        if (lines.Count == 0 || lines.Count > 100 || lines.Any(x => x.Quantity <= 0 || x.Quantity > 10000) || lines.GroupBy(x => x.ProductId).Any(g => g.Count() > 1))
            throw new DomainError("validation", "Supply 1?100 distinct products with positive quantities up to 10,000.");
    }
    public static long Tax(long amount, int basisPoints) => checked((amount * basisPoints + 5000) / 10000);
    public static long Discount(Promotion p, List<OrderLine> lines, long subtotal)
    {
        if (subtotal < p.Minimum) throw new DomainError("promotion_minimum", "The cart does not meet the promotion minimum.");
        var eligible = lines.Where(x => p.ProductId == null || x.ProductId == p.ProductId).ToList();
        var baseAmount = eligible.Sum(x => checked(x.UnitPrice * x.Quantity));
        return p.Kind switch
        {
            "percent" => Math.Min(baseAmount, Tax(baseAmount, Math.Clamp(p.Value, 0, 100) * 100)),
            "fixed" => Math.Min(baseAmount, Math.Max(0, p.Value)),
            "bogo" => eligible.Sum(x => x.UnitPrice * (x.Quantity / 2)),
            "shipping" => 0,
            _ => throw new DomainError("promotion_kind", "Unsupported promotion action.")
        };
    }
    public static List<OrderLine> AllocateAmounts(List<OrderLine> lines, long discount, int taxBps, Guid? eligibleProduct = null)
    {
        var eligible = lines.Where(x => eligibleProduct == null || x.ProductId == eligibleProduct).ToList();
        var total = eligible.Sum(x => checked(x.UnitPrice * x.Quantity));
        if (discount < 0 || discount > total) throw new DomainError("discount", "Discount exceeds eligible merchandise.");
        // Cumulative allocation assigns each rounding cent without charging an ineligible line.
        long cumulative = 0, allocated = 0;
        return lines.Select(line =>
        {
            long d = 0;
            if (eligibleProduct == null || line.ProductId == eligibleProduct)
            {
                cumulative += checked(line.UnitPrice * line.Quantity);
                var next = total == 0 ? 0 : checked(discount * cumulative) / total; d = next - allocated; allocated = next;
            }
            return line with { Discount = d, Tax = Tax(line.UnitPrice * line.Quantity - d, taxBps) };
        }).ToList();
    }
    public static long ReturnValue(OrderLine line, int count, int alreadyReturned)
    {
        var value = line.UnitPrice * line.Quantity - line.Discount + line.Tax;
        // Cumulative allocation avoids losing or creating a rounding cent across partial returns.
        return checked(value * (alreadyReturned + count) / line.Quantity - value * alreadyReturned / line.Quantity);
    }
}
