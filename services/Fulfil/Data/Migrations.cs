using Npgsql;
namespace Fulfil.Data;

public static class Migrations
{
    public static async Task Apply(NpgsqlConnection connection)
    {
        await using var tx = await connection.BeginTransactionAsync();
        const string sql = """
CREATE TABLE IF NOT EXISTS "ApiKeys" (
 "Id" uuid PRIMARY KEY, "MerchantId" uuid NOT NULL REFERENCES "Merchants"("Id"),
 "AccountId" uuid NOT NULL, "Name" text NOT NULL, "KeyHash" text NOT NULL,
 "ScopesJson" jsonb NOT NULL, "Active" boolean NOT NULL, "CreatedAt" timestamptz NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS "IX_ApiKeys_KeyHash" ON "ApiKeys" ("KeyHash");
INSERT INTO schema_versions(version) VALUES ('002-integrations') ON CONFLICT DO NOTHING;
ALTER TABLE "Promotions" ADD COLUMN IF NOT EXISTS "Segment" text NOT NULL DEFAULT 'all';
ALTER TABLE "Promotions" ADD COLUMN IF NOT EXISTS "Priority" integer NOT NULL DEFAULT 0;
ALTER TABLE "Promotions" ADD COLUMN IF NOT EXISTS "Stackable" boolean NOT NULL DEFAULT false;
ALTER TABLE "Promotions" ADD COLUMN IF NOT EXISTS "ExclusionsJson" jsonb NOT NULL DEFAULT '[]';
ALTER TABLE "Promotions" ADD COLUMN IF NOT EXISTS "RuleVersion" integer NOT NULL DEFAULT 1;
ALTER TABLE "Orders" ADD COLUMN IF NOT EXISTS "PromotionsJson" jsonb NOT NULL DEFAULT '[]';
ALTER TABLE "CycleCounts" ADD COLUMN IF NOT EXISTS "AssignedTo" uuid NULL;
ALTER TABLE "CycleCounts" ADD COLUMN IF NOT EXISTS "ObservedAt" timestamptz NULL;
ALTER TABLE "Transfers" ADD COLUMN IF NOT EXISTS "OwnerId" uuid NULL;
ALTER TABLE "Transfers" ADD COLUMN IF NOT EXISTS "NextAction" text NOT NULL DEFAULT '';
ALTER TABLE "GoodsReceipts" ADD COLUMN IF NOT EXISTS "Disposition" text NOT NULL DEFAULT 'accepted';
ALTER TABLE "GoodsReceipts" ADD COLUMN IF NOT EXISTS "Reason" text NOT NULL DEFAULT '';
ALTER TABLE "PurchaseOrders" ADD COLUMN IF NOT EXISTS "Exception" text NOT NULL DEFAULT '';
INSERT INTO schema_versions(version) VALUES ('003-workflow-detail') ON CONFLICT DO NOTHING;
""";
        await using var cmd = new NpgsqlCommand(sql, connection, tx); await cmd.ExecuteNonQueryAsync(); await tx.CommitAsync();
    }
}
