import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export function transaction(db, fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function openDatabase(path) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(
    "PRAGMA busy_timeout=30000; PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;",
  );
  transaction(db, () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS businesses(id INTEGER PRIMARY KEY,name TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS accounts(id INTEGER PRIMARY KEY,tenant_id INTEGER NOT NULL REFERENCES businesses(id),name TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,account_id INTEGER NOT NULL REFERENCES accounts(id),created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS products(id INTEGER PRIMARY KEY,tenant_id INTEGER NOT NULL REFERENCES businesses(id),sku TEXT NOT NULL,name TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',price_cents INTEGER NOT NULL CHECK(price_cents BETWEEN 1 AND 100000000),on_hand INTEGER NOT NULL CHECK(on_hand>=0 AND on_hand<=1000000000),reserved INTEGER NOT NULL DEFAULT 0 CHECK(reserved>=0 AND reserved<=on_hand),version INTEGER NOT NULL DEFAULT 1,UNIQUE(tenant_id,sku));
      CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY,tenant_id INTEGER NOT NULL REFERENCES businesses(id),idempotency_key TEXT NOT NULL,fingerprint TEXT NOT NULL,number TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('reserved','paid','shipped','refunded','cancelled','expired','declined')),total_cents INTEGER NOT NULL CHECK(total_cents>=0),created_at TEXT NOT NULL,expires_at TEXT NOT NULL,restocked INTEGER NOT NULL DEFAULT 0,UNIQUE(tenant_id,idempotency_key));
      CREATE TABLE IF NOT EXISTS order_items(order_id TEXT NOT NULL REFERENCES orders(id),product_id INTEGER NOT NULL REFERENCES products(id),sku TEXT NOT NULL,name TEXT NOT NULL,quantity INTEGER NOT NULL CHECK(quantity>0),unit_price_cents INTEGER NOT NULL,line_total_cents INTEGER NOT NULL,PRIMARY KEY(order_id,product_id));
      CREATE TABLE IF NOT EXISTS activity(id INTEGER PRIMARY KEY,tenant_id INTEGER NOT NULL REFERENCES businesses(id),order_id TEXT REFERENCES orders(id),action TEXT NOT NULL,detail TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS inventory_ledger(id INTEGER PRIMARY KEY,tenant_id INTEGER NOT NULL REFERENCES businesses(id),product_id INTEGER NOT NULL REFERENCES products(id),order_id TEXT REFERENCES orders(id),action TEXT NOT NULL,on_hand_delta INTEGER NOT NULL,reserved_delta INTEGER NOT NULL,created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS orders_tenant ON orders(tenant_id,created_at);
      CREATE INDEX IF NOT EXISTS activity_tenant ON activity(tenant_id,id);
      CREATE INDEX IF NOT EXISTS products_tenant ON products(tenant_id);
    `);
    const version = db.prepare("PRAGMA user_version").get().user_version;
    if (version > 1) throw new Error("This database uses a newer schema.");
    if (!version) {
      db.exec(
        "INSERT INTO businesses VALUES(1,'Northstar Supply'),(2,'Daybreak Goods'); INSERT INTO accounts VALUES(1,1,'Alex Morgan'),(2,2,'Jamie Chen');",
      );
      const insert = db.prepare(
        "INSERT INTO products(tenant_id,sku,name,description,price_cents,on_hand) VALUES(?,?,?,?,?,?)",
      );
      for (const item of [
        [
          1,
          "NS-TOTE",
          "Everyday canvas tote",
          "Heavyweight natural canvas. Made for market mornings and everything after.",
          2800,
          48,
        ],
        [
          1,
          "NS-MUG",
          "Studio ceramic mug",
          "A warm, speckled glaze and an easy handle. 12 oz of everyday ritual.",
          2400,
          32,
        ],
        [
          1,
          "NS-NOTE",
          "Field notes journal",
          "Cloth-bound notebook with 160 dotted pages. A place for your next idea.",
          1800,
          64,
        ],
        [
          1,
          "NS-FLASK",
          "Trail water bottle",
          "Double-wall steel keeps the day moving. Matte forest finish, 750 ml.",
          3600,
          18,
        ],
        [
          1,
          "NS-CANDLE",
          "Cedar & sage candle",
          "Small-batch soy wax with grounded cedar and a quiet herbal finish.",
          3200,
          8,
        ],
        [
          1,
          "NS-CAP",
          "Weekend cotton cap",
          "Soft cotton twill with an adjustable brass closure. Sandstone.",
          2600,
          24,
        ],
        [
          2,
          "DG-TEA",
          "Morning loose-leaf tea",
          "Bright black tea for a slow start. Packed in a reusable tin.",
          1600,
          35,
        ],
        [
          2,
          "DG-CUP",
          "Daybreak glass cup",
          "Clear borosilicate glass with a comfortable rounded silhouette.",
          2200,
          20,
        ],
        [
          2,
          "DG-LINEN",
          "Linen table runner",
          "Washed flax linen that makes an ordinary table feel considered.",
          4800,
          12,
        ],
      ])
        insert.run(...item);
      db.exec("PRAGMA user_version=1");
    }
  });
  return db;
}
