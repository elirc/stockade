// Added 2026-10-01 as part of the upskilling expansion, after the original
// verified build; not part of the original evidence record.
//
// The "next experiment" from journal/READ-ME-FIRST.txt section 6: predict the
// result of expiry and payment arriving at nearly the same time. The race is
// made deterministic with the injected clock (CONTRACT.md): once the clock is
// at or past expires_at the contract gives expiry priority — every state
// action first expires due reservations inside its own write transaction — so
// a boundary-time payment must always lose with a coherent 409, never a 500,
// and the hold must be released exactly once.
import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";
import { createApp } from "../src/app.js";

async function fixture(options = {}) {
  const { app, db, close, expireReservations } = createApp(options);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  return {
    db,
    expireReservations,
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
  return response.headers.get("set-cookie").split(";")[0];
}

async function product(base, cookie, sku, onHand, priceCents = 175) {
  const response = await request(
    base,
    "POST",
    "/api/products",
    { sku, name: sku, priceCents, onHand },
    cookie,
  );
  assert.equal(response.status, 201, JSON.stringify(response.data));
  return response.data.product;
}

async function stock(base, cookie, productId) {
  const response = await request(base, "GET", "/api/products", undefined, cookie);
  assert.equal(response.status, 200, JSON.stringify(response.data));
  return response.data.products.find((row) => row.id === productId);
}

async function orderState(base, cookie, orderId) {
  const response = await request(
    base,
    "GET",
    `/api/orders/${orderId}`,
    undefined,
    cookie,
  );
  assert.equal(response.status, 200, JSON.stringify(response.data));
  return response.data.order;
}

function releases(db, orderId) {
  return db
    .prepare(
      "SELECT action,on_hand_delta,reserved_delta FROM inventory_ledger WHERE order_id=? AND reserved_delta<0 AND on_hand_delta=0",
    )
    .all(orderId);
}

async function reserve(base, cookie, productId, key) {
  const made = await request(
    base,
    "POST",
    "/api/checkouts",
    { idempotencyKey: key, items: [{ productId, quantity: 1 }] },
    cookie,
  );
  assert.equal(made.status, 201, JSON.stringify(made.data));
  return made.data.order;
}

test("payment and expiry sweep racing at the boundary: expiry wins exactly once, payment gets a coherent 409", async () => {
  let now = 1_800_000_000_000;
  const fx = await fixture({ clock: () => now, reservationTtlMs: 1000 });
  try {
    const cookie = await login(fx.base, 1);
    const item = await product(fx.base, cookie, "RACE-EXP", 1);
    const order = await reserve(fx.base, cookie, item.id, "race-exp");
    assert.equal((await stock(fx.base, cookie, item.id)).reserved, 1);

    // Force the reservation exactly onto the expiry boundary (expires_at <=
    // now), then fire the payment and the sweep concurrently.
    now += 1000;
    const [pay, sweep] = await Promise.all([
      request(
        fx.base,
        "POST",
        `/api/orders/${order.id}/pay`,
        { outcome: "approved" },
        cookie,
      ),
      request(fx.base, "POST", "/api/maintenance/expire", {}, cookie),
    ]);

    // Exactly one outcome wins: the order is expired, never paid. The loser
    // is a structured state conflict carrying the current order, not a 500.
    assert.equal(pay.status, 409, JSON.stringify(pay.data));
    assert.equal(pay.data.code, "STATE_CONFLICT");
    assert.equal(pay.data.current.status, "expired");
    assert.equal(sweep.status, 200, JSON.stringify(sweep.data));
    // Whichever transaction ran first performed the expiry; the sweep reports
    // 1 if it won the serialization and 0 if payment's own expiry pass did.
    assert.ok([0, 1].includes(sweep.data.expiredCount));

    assert.equal((await orderState(fx.base, cookie, order.id)).status, "expired");
    // The hold was released exactly once, and conservation holds afterward.
    assert.equal(releases(fx.db, order.id).length, 1);
    const after = await stock(fx.base, cookie, item.id);
    assert.deepEqual(
      [after.onHand, after.reserved, after.available],
      [1, 0, 1],
    );

    // Replaying the checkout key shows the expired order in its current
    // lifecycle state; it does not allocate a new hold.
    const replay = await request(
      fx.base,
      "POST",
      "/api/checkouts",
      { idempotencyKey: "race-exp", items: [{ productId: item.id, quantity: 1 }] },
      cookie,
    );
    assert.equal(replay.status, 200);
    assert.equal(replay.data.order.id, order.id);
    assert.equal(replay.data.order.status, "expired");
    assert.equal((await stock(fx.base, cookie, item.id)).reserved, 0);
  } finally {
    await fx.stop();
  }
});

test("already-expired-then-pay: late payment conflicts and cannot double-release the hold", async () => {
  let now = 1_800_000_000_000;
  const fx = await fixture({ clock: () => now, reservationTtlMs: 1000 });
  try {
    const cookie = await login(fx.base, 1);
    const item = await product(fx.base, cookie, "EXP-PAY", 1);
    const order = await reserve(fx.base, cookie, item.id, "exp-pay");
    now += 1001;

    // The sweep fires first and releases the hold once.
    const swept = await request(
      fx.base,
      "POST",
      "/api/maintenance/expire",
      {},
      cookie,
    );
    assert.equal(swept.status, 200);
    assert.equal(swept.data.expiredCount, 1);
    assert.equal(releases(fx.db, order.id).length, 1);

    // Payment arriving after the expiry fired is a coherent conflict.
    const pay = await request(
      fx.base,
      "POST",
      `/api/orders/${order.id}/pay`,
      { outcome: "approved" },
      cookie,
    );
    assert.equal(pay.status, 409, JSON.stringify(pay.data));
    assert.equal(pay.data.code, "STATE_CONFLICT");

    // Neither the late payment, a repeated sweep, nor a late cancel can
    // release the reservation a second time.
    const again = await request(
      fx.base,
      "POST",
      "/api/maintenance/expire",
      {},
      cookie,
    );
    assert.equal(again.data.expiredCount, 0);
    assert.equal(
      (
        await request(
          fx.base,
          "POST",
          `/api/orders/${order.id}/cancel`,
          {},
          cookie,
        )
      ).status,
      409,
    );
    assert.equal(releases(fx.db, order.id).length, 1);
    const after = await stock(fx.base, cookie, item.id);
    assert.deepEqual([after.onHand, after.reserved, after.available], [1, 0, 1]);
    assert.equal((await orderState(fx.base, cookie, order.id)).status, "expired");
  } finally {
    await fx.stop();
  }
});

test("paid-then-expiry-sweep: a paid order keeps its hold through sweeps arbitrarily far past the TTL", async () => {
  let now = 1_800_000_000_000;
  const fx = await fixture({ clock: () => now, reservationTtlMs: 1000 });
  try {
    const cookie = await login(fx.base, 1);
    const item = await product(fx.base, cookie, "PAID-SWEEP", 1);
    const order = await reserve(fx.base, cookie, item.id, "paid-sweep");

    // Pay one tick before the boundary: the last instant payment can win.
    now += 999;
    const pay = await request(
      fx.base,
      "POST",
      `/api/orders/${order.id}/pay`,
      { outcome: "approved" },
      cookie,
    );
    assert.equal(pay.status, 200, JSON.stringify(pay.data));
    assert.equal(pay.data.order.status, "paid");

    // Sweep at and far beyond the boundary, via the HTTP route and via the
    // server's own sweep entry point: a paid order must never be expired.
    now += 1;
    assert.equal(
      (await request(fx.base, "POST", "/api/maintenance/expire", {}, cookie))
        .data.expiredCount,
      0,
    );
    // One hour = 3600x the TTL, while staying inside the 24h session lifetime.
    now += 3_600_000;
    assert.equal(fx.expireReservations(), 0);
    assert.equal((await orderState(fx.base, cookie, order.id)).status, "paid");
    assert.equal(releases(fx.db, order.id).length, 0);
    // Payment retains the hold: the paid unit stays unavailable until shipped.
    const held = await stock(fx.base, cookie, item.id);
    assert.deepEqual([held.onHand, held.reserved, held.available], [1, 1, 0]);

    // Shipping then consumes the hold; conservation holds at the end.
    assert.equal(
      (
        await request(
          fx.base,
          "POST",
          `/api/orders/${order.id}/ship`,
          {},
          cookie,
        )
      ).status,
      200,
    );
    const shipped = await stock(fx.base, cookie, item.id);
    assert.deepEqual(
      [shipped.onHand, shipped.reserved, shipped.available],
      [0, 0, 0],
    );
  } finally {
    await fx.stop();
  }
});
