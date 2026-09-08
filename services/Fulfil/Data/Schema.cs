using Fulfil.Domain;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using System.Security.Cryptography;
using System.Text;
namespace Fulfil.Data;

public static class Schema
{
    public static readonly Guid DemoMerchant = Guid.Parse("11111111-1111-1111-1111-111111111111");
    public static readonly Guid OtherMerchant = Guid.Parse("22222222-2222-2222-2222-222222222222");
    public static async Task Initialize(StockadeDb db, bool seed)
    {
        await db.Database.OpenConnectionAsync();
        var connection = (NpgsqlConnection)db.Database.GetDbConnection();
        await using var lease = new NpgsqlCommand("SELECT pg_advisory_lock(835201)", connection);
        await lease.ExecuteNonQueryAsync();
        try
        {
            await using (var marker = new NpgsqlCommand("CREATE TABLE IF NOT EXISTS schema_versions (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())", connection))
                await marker.ExecuteNonQueryAsync();
            await using var exists = new NpgsqlCommand("SELECT EXISTS(SELECT 1 FROM schema_versions WHERE version='001-initial')", connection);
            if (!(bool)(await exists.ExecuteScalarAsync())!)
            {
                await using var tx = await connection.BeginTransactionAsync();
                await using (var create = new NpgsqlCommand(db.Database.GenerateCreateScript(), connection, tx)) await create.ExecuteNonQueryAsync();
                const string extra = """
CREATE TABLE "Carts" ("Id" uuid PRIMARY KEY, "MerchantId" uuid NOT NULL REFERENCES "Merchants"("Id"), "LinesJson" jsonb NOT NULL DEFAULT '[]', "UpdatedAt" timestamptz NOT NULL DEFAULT now());
CREATE FUNCTION stockade_append_only() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Stockade history is append-only'; END $$;
CREATE TRIGGER adjustments_immutable BEFORE UPDATE OR DELETE ON "Adjustments" FOR EACH ROW EXECUTE FUNCTION stockade_append_only();
CREATE TRIGGER audit_immutable BEFORE UPDATE OR DELETE ON "AuditEvents" FOR EACH ROW EXECUTE FUNCTION stockade_append_only();
CREATE INDEX catalog_search ON "Products" USING gin(to_tsvector('english', "Name" || ' ' || "Sku" || ' ' || "Category"));
INSERT INTO schema_versions(version) VALUES ('001-initial');
""";
                await using (var command = new NpgsqlCommand(extra, connection, tx)) await command.ExecuteNonQueryAsync();
                await tx.CommitAsync();
            }
            await Migrations.Apply(connection);
            if (seed && !await db.Merchants.AnyAsync()) await Seed(db);
        }
        finally { await using var release = new NpgsqlCommand("SELECT pg_advisory_unlock(835201)", connection); await release.ExecuteNonQueryAsync(); await db.Database.CloseConnectionAsync(); }
    }
    static async Task Seed(StockadeDb db)
    {
        db.Merchants.AddRange(new Merchant { Id = DemoMerchant, Name = "Northline Supply", Slug = "northline" }, new Merchant { Id = OtherMerchant, Name = "Harbor Goods", Slug = "harbor" });
        var hasher = new PasswordHasher<Account>();
        foreach (var tenant in new[] { DemoMerchant, OtherMerchant })
        {
            var account = new Account { MerchantId = tenant, Name = tenant == DemoMerchant ? "Alex Morgan" : "Harbor Admin", Email = tenant == DemoMerchant ? "admin@northline.test" : "admin@harbor.test", Role = "owner" };
            account.PasswordHash = hasher.HashPassword(account, "Stockade-demo-2026!");
            db.Accounts.Add(account);
            var customer = new Account { MerchantId = tenant, Name = "Taylor Reed", Email = tenant == DemoMerchant ? "customer@northline.test" : "customer@harbor.test", Role = "customer" };
            customer.PasswordHash = hasher.HashPassword(customer, "Stockade-demo-2026!");
            db.Accounts.Add(customer);
        }
        var warehouses = new[]{
            new Warehouse{MerchantId=DemoMerchant,Name="West Coast",Code="LAX",City="Los Angeles, CA",Priority=0,ShippingCost=595},
            new Warehouse{MerchantId=DemoMerchant,Name="Pacific Northwest",Code="PDX",City="Portland, OR",Priority=1,ShippingCost=695},
            new Warehouse{MerchantId=DemoMerchant,Name="Central",Code="ORD",City="Chicago, IL",Priority=2,ShippingCost=795},
            new Warehouse{MerchantId=DemoMerchant,Name="East Coast",Code="EWR",City="Newark, NJ",Priority=3,ShippingCost=895}
        };
        db.Warehouses.AddRange(warehouses);
        var catalog = new (string Name, string Sku, string Variant, string Category, long Price, string Color, string Description)[]{
            ("Trail Daypack","NL-PACK-01","Midnight / 24L","Carry",8900,"#27394a","A versatile everyday pack with weather-resistant fabric, a padded laptop sleeve, and considered organization."),
            ("Trail Daypack","NL-PACK-02","Canyon / 24L","Carry",8900,"#b8683c","The same reliable 24-liter pack in a warm canyon finish. Designed for the commute and the long way home."),
            ("Field Bottle","NL-BTL-01","Slate / 750ml","Hydration",3200,"#547684","Double-wall stainless steel, a leak-resistant cap, and a finish that goes from your desk to the trail."),
            ("Field Bottle","NL-BTL-02","Alpine / 750ml","Hydration",3200,"#9fae8d","A dependable insulated bottle in alpine green. Built to be refilled, carried, and used every day."),
            ("Utility Tote","NL-TOTE-01","Natural / One size","Carry",4500,"#baaf98","Heavy cotton canvas with reinforced handles and an inside pocket for the small things."),
            ("Camp Mug","NL-MUG-01","Ember / 350ml","Essentials",2400,"#ba563d","A sturdy insulated mug for morning coffee, late starts, and slow weekends."),
            ("Tech Organizer","NL-TECH-01","Graphite / Small","Essentials",3800,"#525d65","Keep your cables, adapters, and daily essentials in one thoughtfully divided place."),
            ("Everyday Cap","NL-CAP-01","Forest / Adjustable","Apparel",2800,"#496459","An unstructured everyday cap in durable cotton twill with a comfortable adjustable fit.")
        };
        for (var i = 0; i < catalog.Length; i++)
        {
            var c = catalog[i];
            var product = new Product { MerchantId = DemoMerchant, Name = c.Name, Sku = c.Sku, Variant = c.Variant, Category = c.Category, Price = c.Price, Color = c.Color, Description = c.Description };
            db.Products.Add(product);
            for (var w = 0; w < warehouses.Length; w++)
            {
                var quantity = i == 1 && w == 0 ? 5 : 24 + (i * 11 + w * 7) % 65;
                db.Inventory.Add(new Inventory { MerchantId = DemoMerchant, ProductId = product.Id, WarehouseId = warehouses[w].Id, OnHand = quantity });
                db.Adjustments.Add(new Adjustment { MerchantId = DemoMerchant, ProductId = product.Id, WarehouseId = warehouses[w].Id, Quantity = quantity, Reason = "Opening balance", Reference = "seed:" + product.Id + ":" + warehouses[w].Id });
            }
        }
        db.Suppliers.AddRange(new Supplier { MerchantId = DemoMerchant, Name = "Summit Manufacturing", Email = "orders@summit.test", LeadDays = 10 }, new Supplier { MerchantId = DemoMerchant, Name = "Evergreen Textiles", Email = "sales@evergreen.test", LeadDays = 7 });
        db.Promotions.Add(new Promotion { MerchantId = DemoMerchant, Code = "WELCOME10", Kind = "percent", Value = 10, Minimum = 3000, GlobalLimit = 1000, PerCustomerLimit = 1, StartsAt = DateTime.UtcNow.AddDays(-1) });
        db.TaxRates.Add(new TaxRate { MerchantId = DemoMerchant });
        await db.SaveChangesAsync();
    }
}
