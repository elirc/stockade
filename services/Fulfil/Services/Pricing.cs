using Fulfil.Data;
using Fulfil.Domain;
using Microsoft.EntityFrameworkCore;
using System.Text.Json.Nodes;
namespace Fulfil.Services;

public sealed partial class Commerce
{
    record PricingPlan(List<OrderLine> Lines, List<Promotion> Promotions);
    async Task<PricingPlan> Price(StockadeDb db, Actor a, List<OrderLine> original, JsonObject p)
    {
        var codes = p.List<string>("promotions").Select(x => x.Trim().ToUpperInvariant()).ToList();
        var legacy = p.Text("promotion").ToUpperInvariant(); if (legacy.Length > 0) codes.Add(legacy);
        if (codes.Count > 5 || codes.Distinct().Count() != codes.Count) throw new DomainError("promotion_stack", "Use up to five distinct promotion codes.");
        List<Promotion> promotions = codes.Count == 0 ? [] : await db.Promotions.Where(x => x.MerchantId == a.MerchantId && codes.Contains(x.Code)).ToListAsync();
        if (promotions.Count != codes.Count) throw new DomainError("promotion_invalid", "A promotion is unavailable.");
        promotions = promotions.OrderBy(x => x.Priority).ThenBy(x => x.Code, StringComparer.Ordinal).ToList();
        if (promotions.Count > 1 && (promotions.Any(x => !x.Stackable) || promotions.Any(x => Json.Read<List<string>>(x.ExclusionsJson).Any(c => codes.Contains(c)))))
            throw new DomainError("promotion_stack", "These promotions cannot be combined.");
        var returning = promotions.Any(x => x.Segment != "all") && await db.Orders.AnyAsync(x => x.MerchantId == a.MerchantId && x.CustomerId == a.Id && x.Captured > 0);
        var lines = original.ToList();
        foreach (var promotion in promotions)
        {
            if (!promotion.Active || promotion.StartsAt > DateTime.UtcNow || promotion.EndsAt < DateTime.UtcNow)
                throw new DomainError("promotion_invalid", "A promotion is unavailable.");
            if (promotion.Segment == "new" && returning || promotion.Segment == "returning" && !returning)
                throw new DomainError("promotion_segment", "This offer does not apply to your customer segment.");
            if (promotion.Uses >= promotion.GlobalLimit || await db.PromotionUsages.CountAsync(x => x.PromotionId == promotion.Id && x.CustomerId == a.Id) >= promotion.PerCustomerLimit)
                throw new DomainError("promotion_limit", "This promotion's usage limit has been reached.");
            var cart = lines.Sum(x => x.Quantity * x.UnitPrice - x.Discount);
            if (cart < promotion.Minimum) throw new DomainError("promotion_minimum", "The discounted cart does not meet an offer minimum.");
            var eligible = lines.Where(x => promotion.ProductId == null || x.ProductId == promotion.ProductId).ToList();
            var available = eligible.Sum(x => x.UnitPrice * x.Quantity - x.Discount);
            var discount = promotion.Kind switch
            {
                "percent" => Math.Min(available, Rules.Tax(available, promotion.Value * 100)),
                "fixed" => Math.Min(available, promotion.Value),
                "bogo" => eligible.Sum(x => Math.Min(x.UnitPrice * x.Quantity - x.Discount, x.UnitPrice * (x.Quantity / 2))),
                "shipping" => 0L,
                _ => throw new DomainError("promotion_kind", "Unsupported promotion action.")
            };
            long cumulative = 0, allocated = 0;
            lines = lines.Select(line =>
            {
                long increment = 0;
                if (promotion.ProductId == null || line.ProductId == promotion.ProductId)
                { cumulative += line.UnitPrice * line.Quantity - line.Discount; var next = available == 0 ? 0 : checked(discount * cumulative) / available; increment = next - allocated; allocated = next; }
                return line with { Discount = line.Discount + increment };
            }).ToList();
            promotion.Uses++;
        }
        return new(lines, promotions);
    }
}
