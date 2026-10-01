import express from "express";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { openDatabase, transaction } from "./database.js";

class ApiError extends Error {
  constructor(status, code, message, current) {
    super(message);
    Object.assign(this, { status, code, current });
  }
}
const fail = (status, code, message, current) => {
  throw new ApiError(status, code, message, current);
};
const hash = (value) => createHash("sha256").update(value).digest("hex");
function object(value, keys) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((k) => !keys.includes(k))
  )
    fail(
      400,
      "VALIDATION",
      "Provide a JSON object containing only supported fields.",
    );
}
function text(value, name, max, min = 0) {
  if (
    typeof value !== "string" ||
    value.includes("\0") ||
    value.length > max ||
    value.trim().length < min
  )
    fail(400, "VALIDATION", `${name} must contain ${min}–${max} characters.`);
  return value.trim();
}
function integer(value, name, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    fail(
      400,
      "VALIDATION",
      `${name} must be an integer from ${min} to ${max}.`,
    );
  return value;
}
function id(value) {
  if (
    !["number", "string"].includes(typeof value) ||
    !/^\d+$/.test(String(value))
  )
    fail(400, "VALIDATION", "Invalid product or account ID.");
  return integer(Number(value), "ID", 1, Number.MAX_SAFE_INTEGER);
}
const productSelect =
  "SELECT id,sku,name,description,price_cents AS priceCents,on_hand AS onHand,reserved,on_hand-reserved AS available,version FROM products";
const eventSelect =
  "SELECT id,order_id AS orderId,action,detail,created_at AS createdAt FROM activity";

export function createApp({
  dbPath = ":memory:",
  clock = () => Date.now(),
  reservationTtlMs = 300000,
  logger = console,
} = {}) {
  integer(reservationTtlMs, "Reservation TTL", 1, 2147483647);
  const db = openDatabase(dbPath),
    app = express();
  const now = () => new Date(clock()).toISOString();
  const account = (accountId) =>
    db
      .prepare(
        "SELECT a.id,a.name,b.name AS businessName,a.tenant_id AS tenantId FROM accounts a JOIN businesses b ON b.id=a.tenant_id WHERE a.id=?",
      )
      .get(accountId);
  const getProduct = (productId, tenant) => {
    const row = db
      .prepare(`${productSelect} WHERE id=? AND tenant_id=?`)
      .get(productId, tenant);
    if (!row) fail(404, "NOT_FOUND", "Product not found.");
    return row;
  };
  const getOrder = (orderId, tenant) => {
    const row = db
      .prepare(
        "SELECT id,number,status,total_cents AS totalCents,created_at AS createdAt,expires_at AS expiresAt,restocked FROM orders WHERE id=? AND tenant_id=?",
      )
      .get(orderId, tenant);
    if (!row) fail(404, "NOT_FOUND", "Order not found.");
    row.restocked = Boolean(row.restocked);
    row.items = db
      .prepare(
        "SELECT product_id AS productId,sku,name,quantity,unit_price_cents AS unitPriceCents,line_total_cents AS lineTotalCents FROM order_items WHERE order_id=? ORDER BY product_id",
      )
      .all(orderId);
    return row;
  };
  const event = (tenant, orderId, action, detail) =>
    db
      .prepare(
        "INSERT INTO activity(tenant_id,order_id,action,detail,created_at) VALUES(?,?,?,?,?)",
      )
      .run(tenant, orderId, action, detail, now());
  const ledger = (tenant, productId, orderId, action, physical, reserved) =>
    db
      .prepare(
        "INSERT INTO inventory_ledger(tenant_id,product_id,order_id,action,on_hand_delta,reserved_delta,created_at) VALUES(?,?,?,?,?,?,?)",
      )
      .run(tenant, productId, orderId, action, physical, reserved, now());
  function release(order, tenant, status) {
    for (const item of order.items) {
      db.prepare(
        "UPDATE products SET reserved=reserved-?,version=version+1 WHERE id=? AND tenant_id=?",
      ).run(item.quantity, item.productId, tenant);
      ledger(tenant, item.productId, order.id, status, 0, -item.quantity);
    }
    db.prepare("UPDATE orders SET status=? WHERE id=?").run(status, order.id);
    event(
      tenant,
      order.id,
      status,
      `Order ${order.number}: reservation released (${status}).`,
    );
  }
  function expireInside(tenant) {
    const rows = tenant
      ? db
          .prepare(
            "SELECT id,tenant_id FROM orders WHERE status='reserved' AND expires_at<=? AND tenant_id=?",
          )
          .all(now(), tenant)
      : db
          .prepare(
            "SELECT id,tenant_id FROM orders WHERE status='reserved' AND expires_at<=?",
          )
          .all(now());
    for (const row of rows)
      release(getOrder(row.id, row.tenant_id), row.tenant_id, "expired");
    return rows.length;
  }
  const expireReservations = () => transaction(db, () => expireInside());
  app.disable("x-powered-by");
  app.set("query parser", "simple");
  app.use((req, res, next) => {
    res.set({
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "DENY",
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    });
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/i.test(req.headers.host || ""))
      return res
        .status(403)
        .json({
          error: "Use the local address printed by the server.",
          code: "HOST_DENIED",
        });
    if (req.path.startsWith("/api/")) res.set("Cache-Control", "no-store");
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      if (
        req.get("X-Stockade-Request") !== "1" ||
        req.get("Sec-Fetch-Site") === "cross-site" ||
        (req.get("Origin") &&
          req.get("Origin") !== `http://${req.headers.host}`)
      )
        return res
          .status(403)
          .json({
            error: "Same-origin request required.",
            code: "ORIGIN_DENIED",
          });
      if (
        req.headers["content-length"] &&
        Number(req.headers["content-length"]) > 0 &&
        !req.is("application/json")
      )
        return res
          .status(415)
          .json({ error: "Use application/json.", code: "CONTENT_TYPE" });
    }
    next();
  });
  app.use(express.json({ limit: "128kb", strict: true }));
  const tokenFrom = (req) => {
    const token = (req.headers.cookie || "")
      .split(";")
      .map((x) => x.trim())
      .find((x) => x.startsWith("stockade_session="))
      ?.slice(17);
    return token && /^[a-f0-9]{64}$/.test(token) ? token : null;
  };
  app.get("/api/health", (req, res) => res.json({ ok: true }));
  app.get("/api/demo-accounts", (req, res) =>
    res.json({
      accounts: db
        .prepare(
          "SELECT a.id,a.name,b.name AS businessName FROM accounts a JOIN businesses b ON b.id=a.tenant_id",
        )
        .all(),
    }),
  );
  app.post("/api/session", (req, res) => {
    object(req.body, ["accountId"]);
    const user = account(id(req.body.accountId));
    if (!user) fail(404, "NOT_FOUND", "Demo account not found.");
    const token = randomBytes(32).toString("hex");
    transaction(db, () => {
      const old = tokenFrom(req);
      if (old)
        db.prepare("DELETE FROM sessions WHERE token_hash=?").run(hash(old));
      db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(
        hash(token),
        user.id,
        now(),
      );
    });
    res.cookie("stockade_session", token, {
      httpOnly: true,
      sameSite: "strict",
      path: "/",
    });
    res.json({ account: user });
  });
  app.use("/api", (req, res, next) => {
    const token = tokenFrom(req);
    const session =
      token &&
      db
        .prepare(
          "SELECT account_id,created_at FROM sessions WHERE token_hash=?",
        )
        .get(hash(token));
    if (
      !session ||
      !Number.isFinite(Date.parse(session.created_at)) ||
      Date.parse(session.created_at) + 86400000 <= clock()
    )
      fail(401, "UNAUTHENTICATED", "Choose a demo business to continue.");
    req.account = account(session.account_id);
    req.tenant = req.account.tenantId;
    next();
  });
  app.get("/api/session", (req, res) => res.json({ account: req.account }));
  // Optional browser write precondition prevents a stale tab from writing under a newly switched cookie.
  app.use("/api", (req, res, next) => {
    if (
      req.get("X-Stockade-Account") !== undefined &&
      req.get("X-Stockade-Account") !== String(req.account.id)
    )
      fail(
        409,
        "ACCOUNT_CHANGED",
        "The demo business changed in another tab. Reload to continue.",
      );
    next();
  });
  app.delete("/api/session", (req, res) => {
    db.prepare("DELETE FROM sessions WHERE token_hash=?").run(
      hash(tokenFrom(req)),
    );
    res.clearCookie("stockade_session", {
      httpOnly: true,
      sameSite: "strict",
      path: "/",
    });
    res.status(204).end();
  });
  app.get("/api/products", (req, res) => {
    transaction(db, () => expireInside(req.tenant));
    res.json({
      products: db
        .prepare(`${productSelect} WHERE tenant_id=? ORDER BY id`)
        .all(req.tenant),
    });
  });
  app.post("/api/products", (req, res) => {
    object(req.body, ["sku", "name", "description", "priceCents", "onHand"]);
    const sku = text(req.body.sku, "SKU", 32, 2);
    if (!/^[A-Z0-9-]+$/.test(sku))
      fail(
        400,
        "VALIDATION",
        "SKU must use uppercase letters, numbers, and hyphens.",
      );
    const name = text(req.body.name, "Name", 120, 1),
      description = text(req.body.description ?? "", "Description", 4000),
      price = integer(req.body.priceCents, "Price", 1, 100000000),
      stock = integer(req.body.onHand, "On hand", 0, 1000000000);
    const product = transaction(db, () => {
      if (
        db
          .prepare("SELECT id FROM products WHERE tenant_id=? AND sku=?")
          .get(req.tenant, sku)
      )
        fail(409, "DUPLICATE_SKU", "This SKU already exists.");
      const result = db
        .prepare(
          "INSERT INTO products(tenant_id,sku,name,description,price_cents,on_hand) VALUES(?,?,?,?,?,?)",
        )
        .run(req.tenant, sku, name, description, price, stock);
      const productId = Number(result.lastInsertRowid);
      ledger(req.tenant, productId, null, "created", stock, 0);
      event(
        req.tenant,
        null,
        "product_created",
        `${sku}: ${name} created with ${stock} units.`,
      );
      return getProduct(productId, req.tenant);
    });
    res.status(201).json({ product });
  });
  app.patch("/api/products/:id/stock", (req, res) => {
    object(req.body, ["version", "delta", "reason"]);
    const productId = id(req.params.id),
      version = integer(
        req.body.version,
        "Version",
        1,
        Number.MAX_SAFE_INTEGER,
      ),
      delta = integer(req.body.delta, "Delta", -1000000000, 1000000000),
      reason = text(req.body.reason, "Reason", 300, 1);
    const product = transaction(db, () => {
      const current = getProduct(productId, req.tenant);
      if (current.version !== version)
        fail(
          409,
          "VERSION_CONFLICT",
          "Stock changed. Review the current quantities and try again.",
          current,
        );
      if (
        current.onHand + delta < current.reserved ||
        current.onHand + delta > 1000000000
      )
        fail(
          409,
          "STOCK_CONFLICT",
          "Adjustment would violate physical or reserved stock limits.",
          current,
        );
      db.prepare(
        "UPDATE products SET on_hand=on_hand+?,version=version+1 WHERE id=? AND tenant_id=? AND version=?",
      ).run(delta, productId, req.tenant, version);
      ledger(req.tenant, productId, null, "adjusted", delta, 0);
      event(
        req.tenant,
        null,
        "stock_adjusted",
        `${current.sku}: ${delta >= 0 ? "+" : ""}${delta} units. ${reason}`,
      );
      return getProduct(productId, req.tenant);
    });
    res.json({ product });
  });
  app.post("/api/checkouts", (req, res) => {
    object(req.body, ["idempotencyKey", "items"]);
    const key = text(req.body.idempotencyKey, "Idempotency key", 128, 1);
    if (
      !Array.isArray(req.body.items) ||
      !req.body.items.length ||
      req.body.items.length > 20
    )
      fail(400, "VALIDATION", "Choose 1–20 distinct products.");
    const items = req.body.items
      .map((item) => {
        object(item, ["productId", "quantity"]);
        return {
          productId: id(item.productId),
          quantity: integer(item.quantity, "Quantity", 1, 1000),
        };
      })
      .sort((a, b) => a.productId - b.productId);
    if (new Set(items.map((x) => x.productId)).size !== items.length)
      fail(400, "VALIDATION", "Duplicate product IDs are not allowed.");
    const fingerprint = hash(JSON.stringify(items));
    const result = transaction(db, () => {
      expireInside(req.tenant);
      const existing = db
        .prepare(
          "SELECT id,fingerprint FROM orders WHERE tenant_id=? AND idempotency_key=?",
        )
        .get(req.tenant, key);
      if (existing) {
        if (existing.fingerprint !== fingerprint)
          fail(
            409,
            "IDEMPOTENCY_CONFLICT",
            "This checkout key belongs to a different cart.",
          );
        return { replay: true, order: getOrder(existing.id, req.tenant) };
      }
      let total = 0;
      const lines = items.map((item) => {
        const product = getProduct(item.productId, req.tenant);
        if (product.available < item.quantity)
          fail(
            409,
            "SOLD_OUT",
            `${product.name} has only ${product.available} available.`,
            product,
          );
        const lineTotal = product.priceCents * item.quantity;
        total += lineTotal;
        if (!Number.isSafeInteger(total))
          fail(400, "VALIDATION", "Order total is too large.");
        return { ...item, ...product, quantity: item.quantity, lineTotal };
      });
      const orderId = randomUUID(),
        number = `ST-${orderId.slice(0, 8).toUpperCase()}`,
        createdAt = now(),
        expiresAt = new Date(clock() + reservationTtlMs).toISOString();
      db.prepare(
        "INSERT INTO orders(id,tenant_id,idempotency_key,fingerprint,number,status,total_cents,created_at,expires_at) VALUES(?,?,?,?,?,'reserved',?,?,?)",
      ).run(
        orderId,
        req.tenant,
        key,
        fingerprint,
        number,
        total,
        createdAt,
        expiresAt,
      );
      for (const line of lines) {
        const result = db
          .prepare(
            "UPDATE products SET reserved=reserved+?,version=version+1 WHERE id=? AND tenant_id=? AND on_hand-reserved>=?",
          )
          .run(line.quantity, line.productId, req.tenant, line.quantity);
        if (result.changes !== 1)
          fail(409, "SOLD_OUT", "Stock is no longer available.");
        db.prepare("INSERT INTO order_items VALUES(?,?,?,?,?,?,?)").run(
          orderId,
          line.productId,
          line.sku,
          line.name,
          line.quantity,
          line.priceCents,
          line.lineTotal,
        );
        ledger(
          req.tenant,
          line.productId,
          orderId,
          "reserved",
          0,
          line.quantity,
        );
      }
      event(
        req.tenant,
        orderId,
        "reserved",
        `Order ${number} reserved ${items.reduce((n, x) => n + x.quantity, 0)} units. No payment collected.`,
      );
      return { replay: false, order: getOrder(orderId, req.tenant) };
    });
    res.status(result.replay ? 200 : 201).json({ order: result.order });
  });
  app.get("/api/orders", (req, res) => {
    transaction(db, () => expireInside(req.tenant));
    res.json({
      orders: db
        .prepare(
          "SELECT id FROM orders WHERE tenant_id=? ORDER BY created_at DESC,rowid DESC",
        )
        .all(req.tenant)
        .map((row) => getOrder(row.id, req.tenant)),
    });
  });
  app.get("/api/orders/:id", (req, res) => {
    transaction(db, () => expireInside(req.tenant));
    res.json({
      order: getOrder(req.params.id, req.tenant),
      events: db
        .prepare(`${eventSelect} WHERE order_id=? AND tenant_id=? ORDER BY id`)
        .all(req.params.id, req.tenant),
    });
  });
  for (const action of ["pay", "ship", "cancel", "refund"])
    app.post(`/api/orders/:id/${action}`, (req, res) => {
      object(
        req.body,
        action === "pay" ? ["outcome"] : action === "refund" ? ["restock"] : [],
      );
      if (
        action === "pay" &&
        !["approved", "declined"].includes(req.body.outcome)
      )
        fail(
          400,
          "VALIDATION",
          "Choose an approved or declined simulated payment.",
        );
      if (action === "refund" && typeof req.body.restock !== "boolean")
        fail(400, "VALIDATION", "Restock must be true or false.");
      const result = transaction(db, () => {
        expireInside(req.tenant);
        const order = getOrder(req.params.id, req.tenant);
        const target =
          action === "pay"
            ? req.body.outcome === "approved"
              ? "paid"
              : "declined"
            : action === "ship"
              ? "shipped"
              : action === "cancel"
                ? "cancelled"
                : "refunded";
        if (order.status === target) {
          if (action === "refund" && order.restocked !== req.body.restock)
            return { conflict: order };
          return { order };
        }
        const expected =
          action === "ship"
            ? "paid"
            : action === "refund"
              ? "shipped"
              : "reserved";
        if (order.status !== expected) return { conflict: order };
        if (["cancelled", "declined"].includes(target))
          release(order, req.tenant, target);
        else {
          if (
            target === "shipped" ||
            (target === "refunded" && req.body.restock)
          )
            for (const line of order.items) {
              const physical =
                  target === "shipped" ? -line.quantity : line.quantity,
                reserved = target === "shipped" ? -line.quantity : 0;
              const current = getProduct(line.productId, req.tenant);
              if (current.onHand + physical > 1000000000)
                fail(
                  409,
                  "STOCK_CONFLICT",
                  "Restock would exceed the inventory limit.",
                );
              db.prepare(
                "UPDATE products SET on_hand=on_hand+?,reserved=reserved+?,version=version+1 WHERE id=? AND tenant_id=?",
              ).run(physical, reserved, line.productId, req.tenant);
              ledger(
                req.tenant,
                line.productId,
                order.id,
                target,
                physical,
                reserved,
              );
            }
          db.prepare("UPDATE orders SET status=?,restocked=? WHERE id=?").run(
            target,
            target === "refunded" && req.body.restock ? 1 : 0,
            order.id,
          );
          event(
            req.tenant,
            order.id,
            target,
            `Order ${order.number}: ${target}${target === "paid" ? " via simulated payment; no real charge" : target === "refunded" ? ` via simulated refund; ${req.body.restock ? "stock returned" : "no restock"}` : ""}.`,
          );
        }
        return { order: getOrder(order.id, req.tenant) };
      });
      if (result.conflict)
        fail(
          409,
          "STATE_CONFLICT",
          `This action is unavailable for a ${result.conflict.status} order.`,
          result.conflict,
        );
      res.json(result);
    });
  app.post("/api/maintenance/expire", (req, res) => {
    object(req.body, []);
    res.json({ expiredCount: transaction(db, () => expireInside(req.tenant)) });
  });
  app.get("/api/activity", (req, res) =>
    res.json({
      events: db
        .prepare(`${eventSelect} WHERE tenant_id=? ORDER BY id DESC LIMIT 100`)
        .all(req.tenant),
    }),
  );
  app.get("/api/summary", (req, res) => {
    transaction(db, () => expireInside(req.tenant));
    const inventory = db
      .prepare(
        "SELECT COUNT(*) AS productCount,COALESCE(SUM(on_hand-reserved),0) AS availableUnits,COALESCE(SUM(reserved),0) AS reservedUnits FROM products WHERE tenant_id=?",
      )
      .get(req.tenant);
    const orders = db
      .prepare(
        "SELECT COUNT(*) AS orderCount,COALESCE(SUM(CASE WHEN status IN ('paid','shipped') THEN total_cents ELSE 0 END),0) AS paidRevenueCents FROM orders WHERE tenant_id=?",
      )
      .get(req.tenant);
    res.json({ ...inventory, ...orders });
  });
  app.use("/api", (req, res) =>
    res.status(404).json({ error: "API route not found.", code: "NOT_FOUND" }),
  );
  app.use(express.static(fileURLToPath(new URL("../public", import.meta.url))));
  app.use((error, req, res, next) => {
    if (error instanceof ApiError)
      return res
        .status(error.status)
        .json({
          error: error.message,
          code: error.code,
          ...(error.current ? { current: error.current } : {}),
        });
    if (error.type === "entity.too.large")
      return res
        .status(413)
        .json({ error: "Request body is too large.", code: "BODY_TOO_LARGE" });
    if (error.type === "entity.parse.failed")
      return res
        .status(400)
        .json({ error: "Invalid JSON.", code: "VALIDATION" });
    if (/locked|busy/i.test(error.message))
      return res
        .status(503)
        .json({
          error: "Database is busy. Retry the same request key.",
          code: "BUSY",
        });
    logger.error?.("Stockade operation failed", {
      name: error.name,
      message: error.message,
    });
    res
      .status(500)
      .json({
        error:
          "The operation could not be committed. No partial changes were saved.",
        code: "INTERNAL",
      });
  });
  return { app, db, close: () => db.close(), expireReservations };
}
