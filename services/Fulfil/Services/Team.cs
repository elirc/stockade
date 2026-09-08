using Fulfil.Data;
using Fulfil.Domain;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using System.Text.Json.Nodes;
namespace Fulfil.Services;

public sealed partial class Commerce
{
    async Task<object> CreateMember(StockadeDb db, Actor a, JsonObject p)
    {
        a.Demand("owner");
        var role = p.Required("role", 30);
        if (role is not ("admin" or "warehouse" or "support")) throw new DomainError("role", "Choose admin, warehouse or support.");
        var email = p.Required("email", 200).ToLowerInvariant();
        if (!System.Net.Mail.MailAddress.TryCreate(email, out _)) throw new DomainError("email", "Enter a valid email.");
        if (await db.Accounts.AnyAsync(x => x.MerchantId == a.MerchantId && x.Email == email)) throw new DomainError("account_exists", "This email is already registered.", 409);
        Guid? warehouse = null;
        if (role == "warehouse") warehouse = (await Get<Warehouse>(db, a, p.Id("warehouseId"))).Id;
        var password = p.Required("password", 200); if (password.Length < 12) throw new DomainError("password", "Use at least 12 characters.");
        var member = new Account { MerchantId = a.MerchantId, Email = email, Name = p.Required("name", 100), Role = role, WarehouseId = warehouse };
        member.PasswordHash = new PasswordHasher<Account>().HashPassword(member, password); db.Accounts.Add(member);
        return new { member.Id, member.Name, member.Email, member.Role, member.WarehouseId };
    }
    async Task<object> RetryPayment(StockadeDb db, Actor a, JsonObject p)
    {
        Admin(a); var order = await Get<Order>(db, a, p.Id("id")); p.Required("reason");
        if (order.PaymentState is "captured" or "failed" or "voided" or "expired") throw new DomainError("payment_state", "This payment does not need saga retry.", 409);
        order.Attempts = 0; order.UpdatedAt = DateTime.UtcNow.AddSeconds(-5);
        Event(db, order, "recovery_requested", "An administrator requested reconciliation of the existing payment."); return new { order.Id, order.PaymentState };
    }
    async Task<object> RetryRefund(StockadeDb db, Actor a, JsonObject p)
    {
        Admin(a); var refund = await Get<Refund>(db, a, p.Id("id")); p.Required("reason");
        if (refund.State != "pending") throw new DomainError("refund_state", "Only pending refunds can be retried.", 409);
        refund.Attempts = 0; return new { refund.Id, refund.State };
    }
}
