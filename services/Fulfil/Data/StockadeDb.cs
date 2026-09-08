using Fulfil.Domain;
using Microsoft.EntityFrameworkCore;
using System.Reflection;
namespace Fulfil.Data;

public sealed class StockadeDb(DbContextOptions<StockadeDb> options) : DbContext(options)
{
    public DbSet<ApiCredential> ApiKeys => Set<ApiCredential>();
    public DbSet<Merchant> Merchants => Set<Merchant>();
    public DbSet<Account> Accounts => Set<Account>();
    public DbSet<Product> Products => Set<Product>();
    public DbSet<Warehouse> Warehouses => Set<Warehouse>();
    public DbSet<Inventory> Inventory => Set<Inventory>();
    public DbSet<Adjustment> Adjustments => Set<Adjustment>();
    public DbSet<Reservation> Reservations => Set<Reservation>();
    public DbSet<Order> Orders => Set<Order>();
    public DbSet<OrderEvent> OrderEvents => Set<OrderEvent>();
    public DbSet<PaymentAttempt> PaymentAttempts => Set<PaymentAttempt>();
    public DbSet<Refund> Refunds => Set<Refund>();
    public DbSet<Fulfillment> Fulfillments => Set<Fulfillment>();
    public DbSet<ReturnRequest> Returns => Set<ReturnRequest>();
    public DbSet<Promotion> Promotions => Set<Promotion>();
    public DbSet<PromotionUsage> PromotionUsages => Set<PromotionUsage>();
    public DbSet<TaxRate> TaxRates => Set<TaxRate>();
    public DbSet<Transfer> Transfers => Set<Transfer>();
    public DbSet<Supplier> Suppliers => Set<Supplier>();
    public DbSet<PurchaseOrder> PurchaseOrders => Set<PurchaseOrder>();
    public DbSet<GoodsReceipt> GoodsReceipts => Set<GoodsReceipt>();
    public DbSet<CycleCount> CycleCounts => Set<CycleCount>();
    public DbSet<AuditEvent> AuditEvents => Set<AuditEvent>();
    public DbSet<OutboxEvent> Outbox => Set<OutboxEvent>();
    public DbSet<WebhookSubscription> Webhooks => Set<WebhookSubscription>();
    public DbSet<CommandReceipt> Commands => Set<CommandReceipt>();
    public DbSet<ReconciliationRun> Reconciliations => Set<ReconciliationRun>();
    protected override void OnModelCreating(ModelBuilder b)
    {
        foreach (var type in typeof(Record).Assembly.GetTypes().Where(t => t.IsSubclassOf(typeof(Record)) && !t.IsAbstract))
        {
            var entity = b.Entity(type);
            entity.HasBaseType((Type?)null);
            entity.HasKey("Id");
            entity.HasIndex("Id", "MerchantId").IsUnique();
            entity.HasOne(typeof(Merchant)).WithMany().HasForeignKey("MerchantId").OnDelete(DeleteBehavior.Restrict);
        }
        b.Ignore<Record>();
        b.Entity<ApiCredential>().HasIndex(x => x.KeyHash).IsUnique();
        b.Entity<Merchant>().HasIndex(x => x.Slug).IsUnique();
        b.Entity<Account>().HasIndex(x => new { x.MerchantId, x.Email }).IsUnique();
        b.Entity<Product>().HasIndex(x => new { x.MerchantId, x.Sku }).IsUnique();
        b.Entity<Warehouse>().HasIndex(x => new { x.MerchantId, x.Code }).IsUnique();
        b.Entity<Inventory>().Ignore(x => x.Available);
        b.Entity<Inventory>().HasIndex(x => new { x.MerchantId, x.ProductId, x.WarehouseId }).IsUnique();
        b.Entity<Inventory>().ToTable("Inventory", t => t.HasCheckConstraint("inventory_conservation", "\"OnHand\" >= 0 AND \"Reserved\" >= 0 AND \"Held\" >= 0 AND \"OnHand\" - \"Reserved\" - \"Held\" >= 0"));
        b.Entity<Product>().ToTable("Products", t => t.HasCheckConstraint("nonnegative_price", "\"Price\" >= 0"));
        b.Entity<Order>().ToTable("Orders", t => t.HasCheckConstraint("financial_balance", "\"Total\" >= 0 AND \"Captured\" >= 0 AND \"Refunded\" >= 0 AND \"RefundPending\" >= 0 AND \"Refunded\" + \"RefundPending\" <= \"Captured\""));
        b.Entity<Reservation>().ToTable("Reservations", t => t.HasCheckConstraint("reservation_quantity", "\"Quantity\" > 0 AND \"Fulfilled\" >= 0 AND \"Fulfilled\" <= \"Quantity\""));
        b.Entity<Promotion>().ToTable("Promotions", t => t.HasCheckConstraint("promotion_usage", "\"Uses\" >= 0 AND \"Uses\" <= \"GlobalLimit\" AND \"PerCustomerLimit\" > 0"));
        b.Entity<Order>().HasIndex(x => new { x.MerchantId, x.CheckoutKey }).IsUnique();
        b.Entity<Order>().HasIndex(x => new { x.MerchantId, x.CreatedAt, x.Id });
        b.Entity<Order>().HasIndex(x => new { x.PaymentState, x.CreatedAt });
        b.Entity<Reservation>().HasIndex(x => new { x.State, x.ExpiresAt });
        b.Entity<Promotion>().HasIndex(x => new { x.MerchantId, x.Code }).IsUnique();
        b.Entity<PromotionUsage>().HasIndex(x => new { x.PromotionId, x.OrderId }).IsUnique();
        b.Entity<Adjustment>().HasIndex(x => new { x.MerchantId, x.ProductId, x.WarehouseId });
        b.Entity<CommandReceipt>().HasIndex(x => new { x.MerchantId, x.Key }).IsUnique();
        b.Entity<OutboxEvent>().HasIndex(x => new { x.State, x.AvailableAt });
        b.Entity<ReconciliationRun>().HasIndex(x => new { x.MerchantId, x.CreatedAt });
        b.Entity<Inventory>().HasOne<Product>().WithMany().HasForeignKey(x => new { x.ProductId, x.MerchantId }).HasPrincipalKey(x => new { x.Id, x.MerchantId }).OnDelete(DeleteBehavior.Restrict);
        b.Entity<Inventory>().HasOne<Warehouse>().WithMany().HasForeignKey(x => new { x.WarehouseId, x.MerchantId }).HasPrincipalKey(x => new { x.Id, x.MerchantId }).OnDelete(DeleteBehavior.Restrict);
        b.Entity<Order>().HasOne<Account>().WithMany().HasForeignKey(x => new { x.CustomerId, x.MerchantId }).HasPrincipalKey(x => new { x.Id, x.MerchantId }).OnDelete(DeleteBehavior.Restrict);
        b.Entity<Reservation>().HasOne<Order>().WithMany().HasForeignKey(x => new { x.OrderId, x.MerchantId }).HasPrincipalKey(x => new { x.Id, x.MerchantId }).OnDelete(DeleteBehavior.Restrict);
        b.Entity<Refund>().HasOne<Order>().WithMany().HasForeignKey(x => new { x.OrderId, x.MerchantId }).HasPrincipalKey(x => new { x.Id, x.MerchantId }).OnDelete(DeleteBehavior.Restrict);
        foreach (var type in b.Model.GetEntityTypes())
            foreach (var property in type.GetProperties().Where(p => p.ClrType == typeof(string) && p.Name.EndsWith("Json")))
                property.SetColumnType("jsonb");
    }
}
