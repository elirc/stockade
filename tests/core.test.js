import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { request as httpRequest } from "node:http";
import { createApp } from "../src/app.js";

async function fixture(t, options = {}) {
  const instance = createApp({ logger: { error() {} }, ...options });
  const server = instance.app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = "";
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    instance.close();
  });
  async function request(path, body, method = "POST", extra = {}) {
    const response = await fetch(base + path, {
      method: body === undefined ? "GET" : method,
      headers: {
        "Content-Type": "application/json",
        "X-Stockade-Request": "1",
        cookie,
        ...extra,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (path === "/api/session" && response.ok && method === "POST")
      cookie = response.headers.get("set-cookie")?.split(";")[0] || cookie;
    return {
      status: response.status,
      data: response.status === 204 ? {} : await response.json(),
    };
  }
  await request("/api/session", { accountId: 1 });
  return { ...instance, request, base };
}

test("reservation, payment, shipping and restocking preserve physical inventory and snapshot price", async (t) => {
  const x = await fixture(t),
    r = x.request;
  const initial = (await r("/api/products")).data.products[0];
  const checkout = await r("/api/checkouts", {
    idempotencyKey: "journey",
    items: [{ productId: initial.id, quantity: 3 }],
  });
  assert.equal(checkout.status, 201);
  const order = checkout.data.order;
  assert.equal(order.totalCents, initial.priceCents * 3);
  let p = (await r("/api/products")).data.products[0];
  assert.equal(p.onHand, initial.onHand);
  assert.equal(p.reserved, 3);
  assert.equal(
    (await r(`/api/orders/${order.id}/pay`, { outcome: "approved" })).data.order
      .status,
    "paid",
  );
  assert.equal(
    (await r(`/api/orders/${order.id}/ship`, {})).data.order.status,
    "shipped",
  );
  p = (await r("/api/products")).data.products[0];
  assert.equal(p.onHand, initial.onHand - 3);
  assert.equal(p.reserved, 0);
  await r(`/api/orders/${order.id}/refund`, { restock: true });
  await r(`/api/orders/${order.id}/refund`, { restock: true });
  p = (await r("/api/products")).data.products[0];
  assert.equal(p.onHand, initial.onHand);
  assert.equal(p.reserved, 0);
  assert.equal((await r("/api/summary")).data.paidRevenueCents, 0);
  assert.equal(
    x.db
      .prepare(
        "SELECT COUNT(*) AS n FROM inventory_ledger WHERE order_id=? AND action='refunded'",
      )
      .get(order.id).n,
    1,
  );
});

test("normalized checkout intent replays after cancellation without another hold", async (t) => {
  const { request: r } = await fixture(t);
  const body = {
    idempotencyKey: "normalize",
    items: [
      { productId: "2", quantity: 2 },
      { productId: 1, quantity: 1 },
    ],
  };
  const original = (await r("/api/checkouts", body)).data.order;
  await r(`/api/orders/${original.id}/cancel`, {});
  const replay = await r("/api/checkouts", {
    ...body,
    items: [
      { productId: 1, quantity: 1 },
      { productId: 2, quantity: 2 },
    ],
  });
  assert.equal(replay.status, 200);
  assert.equal(replay.data.order.id, original.id);
  assert.equal(replay.data.order.status, "cancelled");
  assert.equal((await r("/api/summary")).data.reservedUnits, 0);
  assert.equal(
    (
      await r("/api/checkouts", {
        ...body,
        items: [{ productId: 1, quantity: 2 }],
      })
    ).status,
    409,
  );
});

test("an expired reservation cannot be revived by payment or replay", async (t) => {
  let time = Date.parse("2026-01-01T12:00:00Z");
  const { request: r } = await fixture(t, {
    clock: () => time,
    reservationTtlMs: 1000,
  });
  const order = (
    await r("/api/checkouts", {
      idempotencyKey: "expires",
      items: [{ productId: 1, quantity: 1 }],
    })
  ).data.order;
  time += 1000;
  assert.equal(
    (await r(`/api/orders/${order.id}/pay`, { outcome: "approved" })).status,
    409,
  );
  assert.equal(
    (await r(`/api/orders/${order.id}`)).data.order.status,
    "expired",
  );
  assert.equal((await r("/api/maintenance/expire", {})).data.expiredCount, 0);
  assert.equal((await r("/api/summary")).data.reservedUnits, 0);
  assert.equal(
    (
      await r("/api/checkouts", {
        idempotencyKey: "expires",
        items: [{ productId: 1, quantity: 1 }],
      })
    ).data.order.status,
    "expired",
  );
});

test("stock changes require a current version and an audit write", async (t) => {
  const { request: r, db } = await fixture(t);
  const p = (await r("/api/products")).data.products[0];
  assert.equal(
    (
      await r(
        `/api/products/${p.id}/stock`,
        { version: p.version, delta: 2, reason: "Received" },
        "PATCH",
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await r(
        `/api/products/${p.id}/stock`,
        { version: p.version, delta: 2, reason: "Stale" },
        "PATCH",
      )
    ).data.code,
    "VERSION_CONFLICT",
  );
  db.exec(
    "CREATE TRIGGER reject_activity BEFORE INSERT ON activity BEGIN SELECT RAISE(ABORT,'audit failure'); END;",
  );
  assert.equal(
    (
      await r(
        `/api/products/${p.id}/stock`,
        { version: p.version + 1, delta: 5, reason: "Must roll back" },
        "PATCH",
      )
    ).status,
    500,
  );
  const actual = (await r("/api/products")).data.products[0];
  assert.equal(actual.onHand, p.onHand + 2);
  assert.equal(actual.version, p.version + 1);
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM inventory_ledger WHERE action='adjusted'",
      )
      .get().n,
    1,
  );
});

test("input boundary and local request protections are enforced", async (t) => {
  const { request: r, base } = await fixture(t);
  assert.equal(
    (
      await r("/api/products", {
        sku: "VALID",
        name: "x\0y",
        priceCents: 20,
        onHand: 1,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await r("/api/checkouts", {
        idempotencyKey: "override",
        items: [{ productId: 1, quantity: 1 }],
        totalCents: 1,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await r("/api/checkouts", {
        idempotencyKey: "duplicate",
        items: [
          { productId: 1, quantity: 1 },
          { productId: "1", quantity: 1 },
        ],
      })
    ).status,
    400,
  );
  const hostileHostStatus = await new Promise((resolve, reject) => {
    const req = httpRequest(
      `${base}/api/products`,
      { headers: { Host: "evil.example" } },
      (response) => {
        response.resume();
        resolve(response.statusCode);
      },
    );
    req.on("error", reject);
    req.end();
  });
  assert.equal(hostileHostStatus, 403);
  assert.equal(
    (
      await r("/api/maintenance/expire", {}, "POST", {
        "X-Stockade-Request": "0",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await r("/api/maintenance/expire", {}, "POST", {
        Origin: "https://evil.example",
      })
    ).status,
    403,
  );
});
