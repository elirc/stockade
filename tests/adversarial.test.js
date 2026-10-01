import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createApp } from "../src/app.js";

async function fixture(options = {}) {
  const { app, db, close } = createApp(options);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  return {
    db,
    base: `http://127.0.0.1:${server.address().port}`,
    async stop() {
      await new Promise((resolve) => server.close(resolve));
      close();
    },
  };
}

async function request(base, method, path, body, cookie) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (method !== "GET") headers["X-Stockade-Request"] = "1";
  if (body !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(base + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const raw = await response.text();
  return {
    status: response.status,
    data: raw ? JSON.parse(raw) : undefined,
    headers: response.headers,
  };
}

async function login(base, accountId) {
  const response = await request(base, "POST", "/api/session", { accountId });
  assert.equal(response.status, 200, JSON.stringify(response.data));
  const cookie = response.headers.get("set-cookie");
  assert.match(cookie, /httponly/i);
  assert.match(cookie, /samesite=strict/i);
  return cookie.split(";")[0];
}

async function product(base, cookie, sku, onHand, priceCents = 175) {
  const response = await request(
    base,
    "POST",
    "/api/products",
    {
      sku,
      name: sku,
      priceCents,
      onHand,
    },
    cookie,
  );
  assert.equal(response.status, 201, JSON.stringify(response.data));
  return response.data.product;
}

async function products(base, cookie) {
  const response = await request(
    base,
    "GET",
    "/api/products",
    undefined,
    cookie,
  );
  assert.equal(response.status, 200, JSON.stringify(response.data));
  return response.data.products;
}

test("multi-line checkout is atomic, priced by server, and durable key replays one order", async () => {
  const fx = await fixture();
  try {
    const cookie = await login(fx.base, 1);
    const a = await product(fx.base, cookie, "ATOM-A", 2, 175);
    const b = await product(fx.base, cookie, "ATOM-B", 1, 230);
    const rejected = await request(
      fx.base,
      "POST",
      "/api/checkouts",
      {
        idempotencyKey: "multi-fail",
        items: [
          { productId: a.id, quantity: 2 },
          { productId: b.id, quantity: 2 },
        ],
      },
      cookie,
    );
    assert.equal(rejected.status, 409, JSON.stringify(rejected.data));
    for (const item of (await products(fx.base, cookie)).filter((row) =>
      [a.id, b.id].includes(row.id),
    )) {
      assert.equal(
        item.reserved,
        0,
        "a rejected line must not retain reservations on another line",
      );
    }
    const intent = {
      idempotencyKey: "multi-good",
      items: [
        { productId: a.id, quantity: 1 },
        { productId: b.id, quantity: 1 },
      ],
    };
    const created = await request(
      fx.base,
      "POST",
      "/api/checkouts",
      intent,
      cookie,
    );
    assert.equal(created.status, 201, JSON.stringify(created.data));
    assert.equal(created.data.order.totalCents, 405);
    assert.deepEqual(
      created.data.order.items.map((line) => line.unitPriceCents),
      [175, 230],
    );
    const replay = await request(
      fx.base,
      "POST",
      "/api/checkouts",
      intent,
      cookie,
    );
    assert.equal(replay.status, 200, JSON.stringify(replay.data));
    assert.equal(replay.data.order.id, created.data.order.id);
    const conflicting = await request(
      fx.base,
      "POST",
      "/api/checkouts",
      {
        ...intent,
        items: [{ productId: a.id, quantity: 2 }],
      },
      cookie,
    );
    assert.equal(conflicting.status, 409);
    const current = await products(fx.base, cookie);
    assert.equal(current.find((row) => row.id === a.id).reserved, 1);
    assert.equal(current.find((row) => row.id === b.id).reserved, 1);
    assert.equal(
      (
        await request(
          fx.base,
          "POST",
          "/api/checkouts",
          {
            idempotencyKey: "price-override",
            items: [{ productId: a.id, quantity: 1, unitPriceCents: 1 }],
          },
          cookie,
        )
      ).status,
      400,
    );
  } finally {
    await fx.stop();
  }
});

test("expiry cannot pay, and repeated shipping/refund cannot change stock twice", async () => {
  let now = 1_800_000_000_000;
  const fx = await fixture({ clock: () => now, reservationTtlMs: 1000 });
  try {
    const cookie = await login(fx.base, 1);
    const item = await product(fx.base, cookie, "EXPIRE-1", 1);
    const hold = await request(
      fx.base,
      "POST",
      "/api/checkouts",
      {
        idempotencyKey: "expire-hold",
        items: [{ productId: item.id, quantity: 1 }],
      },
      cookie,
    );
    assert.equal(hold.status, 201, JSON.stringify(hold.data));
    now += 1001;
    const latePay = await request(
      fx.base,
      "POST",
      `/api/orders/${hold.data.order.id}/pay`,
      { outcome: "approved" },
      cookie,
    );
    assert.equal(latePay.status, 409, JSON.stringify(latePay.data));
    await request(fx.base, "POST", "/api/maintenance/expire", {}, cookie);
    assert.equal(
      (await products(fx.base, cookie)).find((row) => row.id === item.id)
        .reserved,
      0,
    );
    const next = await request(
      fx.base,
      "POST",
      "/api/checkouts",
      {
        idempotencyKey: "paid-hold",
        items: [{ productId: item.id, quantity: 1 }],
      },
      cookie,
    );
    assert.equal(next.status, 201, JSON.stringify(next.data));
    const id = next.data.order.id;
    assert.equal(
      (
        await request(
          fx.base,
          "POST",
          `/api/orders/${id}/pay`,
          { outcome: "approved" },
          cookie,
        )
      ).status,
      200,
    );
    now += 1001;
    await request(fx.base, "POST", "/api/maintenance/expire", {}, cookie);
    assert.equal(
      (await products(fx.base, cookie)).find((row) => row.id === item.id)
        .reserved,
      1,
      "paid orders must not expire",
    );
    assert.equal(
      (await request(fx.base, "POST", `/api/orders/${id}/ship`, {}, cookie))
        .status,
      200,
    );
    const shipped = (await products(fx.base, cookie)).find(
      (row) => row.id === item.id,
    );
    assert.equal(shipped.onHand, 0);
    assert.equal(shipped.reserved, 0);
    assert.ok(
      [200, 409].includes(
        (await request(fx.base, "POST", `/api/orders/${id}/ship`, {}, cookie))
          .status,
      ),
    );
    assert.equal(
      (
        await request(
          fx.base,
          "POST",
          `/api/orders/${id}/refund`,
          { restock: true },
          cookie,
        )
      ).status,
      200,
    );
    assert.ok(
      [200, 409].includes(
        (
          await request(
            fx.base,
            "POST",
            `/api/orders/${id}/refund`,
            { restock: true },
            cookie,
          )
        ).status,
      ),
    );
    const finalStock = (await products(fx.base, cookie)).find(
      (row) => row.id === item.id,
    );
    assert.equal(finalStock.onHand, 1);
    assert.equal(finalStock.reserved, 0);
  } finally {
    await fx.stop();
  }
});

test("cross-tenant IDs, stale adjustment, and failed audit insertion cannot mutate inventory", async () => {
  const fx = await fixture();
  try {
    const north = await login(fx.base, 1);
    const south = await login(fx.base, 2);
    const item = await product(fx.base, north, "TENANT-1", 3);
    const order = await request(
      fx.base,
      "POST",
      "/api/checkouts",
      {
        idempotencyKey: "tenant-order",
        items: [{ productId: item.id, quantity: 1 }],
      },
      north,
    );
    assert.equal(order.status, 201);
    assert.equal(
      (
        await request(
          fx.base,
          "GET",
          `/api/orders/${order.data.order.id}`,
          undefined,
          south,
        )
      ).status,
      404,
    );
    assert.equal(
      (
        await request(
          fx.base,
          "POST",
          "/api/checkouts",
          {
            idempotencyKey: "foreign-item",
            items: [{ productId: item.id, quantity: 1 }],
          },
          south,
        )
      ).status,
      404,
    );
    assert.equal(
      (
        await request(
          fx.base,
          "PATCH",
          `/api/products/${item.id}/stock`,
          {
            version: item.version,
            delta: 1,
            reason: "foreign",
          },
          south,
        )
      ).status,
      404,
    );
    const current = (await products(fx.base, north)).find(
      (row) => row.id === item.id,
    );
    assert.equal(
      (
        await request(
          fx.base,
          "PATCH",
          `/api/products/${item.id}/stock`,
          {
            version: item.version,
            delta: 1,
            reason: "stale",
          },
          north,
        )
      ).status,
      409,
    );
    assert.equal(
      (
        await request(
          fx.base,
          "PATCH",
          `/api/products/${item.id}/stock`,
          {
            version: current.version,
            delta: -3,
            reason: "would undercut hold",
          },
          north,
        )
      ).status,
      409,
    );
    fx.db.exec(
      `CREATE TRIGGER reject_activity BEFORE INSERT ON activity BEGIN SELECT RAISE(ABORT, 'forced audit failure'); END`,
    );
    const failed = await request(
      fx.base,
      "POST",
      "/api/checkouts",
      {
        idempotencyKey: "audit-failure",
        items: [{ productId: item.id, quantity: 1 }],
      },
      north,
    );
    assert.ok(failed.status >= 400, JSON.stringify(failed.data));
    fx.db.exec("DROP TRIGGER reject_activity");
    const after = (await products(fx.base, north)).find(
      (row) => row.id === item.id,
    );
    assert.equal(after.onHand, current.onHand);
    assert.equal(after.reserved, current.reserved);
    assert.equal(
      (
        await request(
          fx.base,
          "POST",
          "/api/checkouts",
          {
            idempotencyKey: "audit-failure",
            items: [{ productId: item.id, quantity: 1 }],
          },
          north,
        )
      ).status,
      201,
      "failed transaction must not consume the idempotency key",
    );
  } finally {
    await fx.stop();
  }
});

test("order and session persist when a fresh app opens the same SQLite file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "stockade-restart-"));
  const path = join(dir, "stockade.sqlite");
  let first;
  let second;
  try {
    first = await fixture({ dbPath: path });
    const cookie = await login(first.base, 1);
    const item = await product(first.base, cookie, "RESTART-1", 1);
    const created = await request(
      first.base,
      "POST",
      "/api/checkouts",
      {
        idempotencyKey: "restart-key",
        items: [{ productId: item.id, quantity: 1 }],
      },
      cookie,
    );
    assert.equal(created.status, 201);
    await first.stop();
    first = undefined;
    second = await fixture({ dbPath: path });
    assert.equal(
      (await request(second.base, "GET", "/api/session", undefined, cookie))
        .status,
      200,
    );
    assert.equal(
      (
        await request(
          second.base,
          "GET",
          `/api/orders/${created.data.order.id}`,
          undefined,
          cookie,
        )
      ).data.order.id,
      created.data.order.id,
    );
    const replay = await request(
      second.base,
      "POST",
      "/api/checkouts",
      {
        idempotencyKey: "restart-key",
        items: [{ productId: item.id, quantity: 1 }],
      },
      cookie,
    );
    assert.equal(replay.status, 200);
    assert.equal(replay.data.order.id, created.data.order.id);
  } finally {
    if (first) await first.stop();
    if (second) await second.stop();
    await rm(dir, { recursive: true, force: true });
  }
});

test("stock upper bound and refund restock failure leave the shipped order unchanged", async () => {
  const fx = await fixture();
  try {
    const cookie = await login(fx.base, 1);
    const ceiling = await product(fx.base, cookie, "CEILING-1", 999_999_999);
    const tooMuch = await request(
      fx.base,
      "PATCH",
      `/api/products/${ceiling.id}/stock`,
      {
        version: ceiling.version,
        delta: 2,
        reason: "past physical limit",
      },
      cookie,
    );
    assert.ok(
      [400, 409].includes(tooMuch.status),
      JSON.stringify(tooMuch.data),
    );
    assert.equal(
      (await products(fx.base, cookie)).find((row) => row.id === ceiling.id)
        .onHand,
      999_999_999,
    );

    const item = await product(fx.base, cookie, "REFUND-CAP", 1);
    const made = await request(
      fx.base,
      "POST",
      "/api/checkouts",
      {
        idempotencyKey: "refund-cap",
        items: [{ productId: item.id, quantity: 1 }],
      },
      cookie,
    );
    assert.equal(made.status, 201);
    const path = `/api/orders/${made.data.order.id}`;
    assert.equal(
      (
        await request(
          fx.base,
          "POST",
          `${path}/pay`,
          { outcome: "approved" },
          cookie,
        )
      ).status,
      200,
    );
    assert.equal(
      (await request(fx.base, "POST", `${path}/ship`, {}, cookie)).status,
      200,
    );
    const shippedStock = (await products(fx.base, cookie)).find(
      (row) => row.id === item.id,
    );
    assert.equal(shippedStock.onHand, 0);
    const replenish = await request(
      fx.base,
      "PATCH",
      `/api/products/${item.id}/stock`,
      {
        version: shippedStock.version,
        delta: 1_000_000_000,
        reason: "fill to physical cap",
      },
      cookie,
    );
    assert.equal(replenish.status, 200, JSON.stringify(replenish.data));
    const rejected = await request(
      fx.base,
      "POST",
      `${path}/refund`,
      { restock: true },
      cookie,
    );
    assert.ok(
      [400, 409].includes(rejected.status),
      JSON.stringify(rejected.data),
    );
    assert.equal(
      (await request(fx.base, "GET", path, undefined, cookie)).data.order
        .status,
      "shipped",
    );
    assert.equal(
      (await products(fx.base, cookie)).find((row) => row.id === item.id)
        .onHand,
      1_000_000_000,
    );
    assert.equal(
      (
        await request(
          fx.base,
          "POST",
          `${path}/refund`,
          { restock: false },
          cookie,
        )
      ).status,
      200,
    );
    assert.equal(
      (await products(fx.base, cookie)).find((row) => row.id === item.id)
        .onHand,
      1_000_000_000,
    );
    const replay = await request(
      fx.base,
      "POST",
      "/api/checkouts",
      {
        idempotencyKey: "refund-cap",
        items: [{ productId: item.id, quantity: 1 }],
      },
      cookie,
    );
    assert.equal(replay.status, 200);
    assert.equal(replay.data.order.id, made.data.order.id);
    assert.equal(replay.data.order.status, "refunded");
    assert.equal(
      (await products(fx.base, cookie)).find((row) => row.id === item.id)
        .reserved,
      0,
    );
  } finally {
    await fx.stop();
  }
});

test("payment outcome replay and competing cancel/payment preserve one reservation transition", async () => {
  const fx = await fixture();
  try {
    const cookie = await login(fx.base, 1);
    const item = await product(fx.base, cookie, "STATE-RACE", 2);
    const first = await request(
      fx.base,
      "POST",
      "/api/checkouts",
      {
        idempotencyKey: "pay-intent",
        items: [{ productId: item.id, quantity: 1 }],
      },
      cookie,
    );
    assert.equal(first.status, 201);
    const firstPath = `/api/orders/${first.data.order.id}`;
    assert.equal(
      (
        await request(
          fx.base,
          "POST",
          `${firstPath}/pay`,
          { outcome: "declined" },
          cookie,
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await request(
          fx.base,
          "POST",
          `${firstPath}/pay`,
          { outcome: "declined" },
          cookie,
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await request(
          fx.base,
          "POST",
          `${firstPath}/pay`,
          { outcome: "approved" },
          cookie,
        )
      ).status,
      409,
    );
    assert.equal(
      (await products(fx.base, cookie)).find((row) => row.id === item.id)
        .reserved,
      0,
    );

    const second = await request(
      fx.base,
      "POST",
      "/api/checkouts",
      {
        idempotencyKey: "race-intent",
        items: [{ productId: item.id, quantity: 1 }],
      },
      cookie,
    );
    assert.equal(second.status, 201);
    const path = `/api/orders/${second.data.order.id}`;
    const [paid, cancelled] = await Promise.all([
      request(fx.base, "POST", `${path}/pay`, { outcome: "approved" }, cookie),
      request(fx.base, "POST", `${path}/cancel`, {}, cookie),
    ]);
    assert.deepEqual([paid.status, cancelled.status].sort(), [200, 409]);
    const current = (await request(fx.base, "GET", path, undefined, cookie))
      .data.order;
    const stock = (await products(fx.base, cookie)).find(
      (row) => row.id === item.id,
    );
    assert.ok(["paid", "cancelled"].includes(current.status));
    assert.equal(stock.reserved, current.status === "paid" ? 1 : 0);
    const replay = await request(
      fx.base,
      "POST",
      "/api/checkouts",
      {
        idempotencyKey: "race-intent",
        items: [{ productId: item.id, quantity: 1 }],
      },
      cookie,
    );
    assert.equal(replay.status, 200);
    assert.equal(replay.data.order.id, current.id);
    assert.equal(replay.data.order.status, current.status);
  } finally {
    await fx.stop();
  }
});

test("aged persisted session is rejected", async () => {
  const fx = await fixture();
  try {
    const cookie = await login(fx.base, 1);
    fx.db
      .prepare("UPDATE sessions SET created_at=?")
      .run("2000-01-01T00:00:00.000Z");
    assert.equal(
      (await request(fx.base, "GET", "/api/session", undefined, cookie)).status,
      401,
    );
  } finally {
    await fx.stop();
  }
});
