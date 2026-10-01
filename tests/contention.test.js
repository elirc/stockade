import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

async function start(dbPath) {
  const child = spawn(process.execPath, ["src/server.js"], {
    cwd: root,
    env: { ...process.env, PORT: "0", DB_PATH: dbPath },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stderr.setEncoding("utf8").on("data", (chunk) => {
    stderr += chunk;
  });
  const base = await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(new Error(`Stockade startup timed out: ${stdout}\n${stderr}`)),
      15000,
    );
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Stockade exited ${code}: ${stdout}\n${stderr}`));
    });
    child.stdout.setEncoding("utf8").on("data", (chunk) => {
      stdout += chunk;
      const match = stdout.match(/Stockade ready (http:\/\/127\.0\.0\.1:\d+)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
  });
  return {
    child,
    base,
    get stderr() {
      return stderr;
    },
  };
}

async function stop(server) {
  if (!server || server.child.exitCode !== null) return;
  const exit = once(server.child, "exit");
  server.child.kill();
  await exit;
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

test(
  "500 checkouts against 100 units across two independent Node processes conserve stock",
  { timeout: 90000 },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "stockade-contention-"));
    const dbPath = join(dir, "shared.sqlite");
    let first;
    let second;
    let restarted;
    try {
      first = await start(dbPath);
      second = await start(dbPath);
      const a = await request(first.base, "POST", "/api/session", {
        accountId: 1,
      });
      const b = await request(second.base, "POST", "/api/session", {
        accountId: 1,
      });
      assert.equal(a.status, 200, JSON.stringify(a.data));
      assert.equal(b.status, 200, JSON.stringify(b.data));
      const cookieA = a.headers.get("set-cookie").split(";")[0];
      const cookieB = b.headers.get("set-cookie").split(";")[0];
      const made = await request(
        first.base,
        "POST",
        "/api/products",
        {
          sku: "RACE-100",
          name: "Race inventory",
          priceCents: 500,
          onHand: 100,
        },
        cookieA,
      );
      assert.equal(made.status, 201, JSON.stringify(made.data));
      const productId = made.data.product.id;
      const startedAt = performance.now();
      const attempts = Array.from({ length: 500 }, (_, index) =>
        request(
          index % 2 === 0 ? first.base : second.base,
          "POST",
          "/api/checkouts",
          {
            idempotencyKey: `race-${index}`,
            items: [{ productId, quantity: 1 }],
          },
          index % 2 === 0 ? cookieA : cookieB,
        ),
      );
      const results = await Promise.all(attempts);
      const elapsedMs = Math.round(performance.now() - startedAt);
      const statusCount = results.reduce((counts, result) => {
        counts[result.status] = (counts[result.status] ?? 0) + 1;
        return counts;
      }, {});
      console.info(
        `Stockade two-process contention: 500 requests in ${elapsedMs}ms; outcomes ${JSON.stringify(statusCount)}`,
      );
      assert.deepEqual(
        statusCount,
        { 201: 100, 409: 400 },
        `500 checkout outcomes in ${elapsedMs}ms: ${JSON.stringify(statusCount)}; logs: ${first.stderr}\n${second.stderr}`,
      );
      assert.equal(
        new Set(
          results
            .filter((result) => result.status === 201)
            .map((result) => result.data.order.id),
        ).size,
        100,
      );
      const read = await request(
        second.base,
        "GET",
        "/api/products",
        undefined,
        cookieB,
      );
      assert.equal(read.status, 200);
      const stock = read.data.products.find((item) => item.id === productId);
      assert.deepEqual(
        [stock.onHand, stock.reserved, stock.available],
        [100, 100, 0],
      );

      const spare = await request(
        first.base,
        "POST",
        "/api/products",
        {
          sku: "RACE-KEY",
          name: "Duplicate key race",
          priceCents: 500,
          onHand: 1,
        },
        cookieA,
      );
      assert.equal(spare.status, 201);
      const duplicate = {
        idempotencyKey: "same-key-two-processes",
        items: [{ productId: spare.data.product.id, quantity: 1 }],
      };
      const [left, right] = await Promise.all([
        request(first.base, "POST", "/api/checkouts", duplicate, cookieA),
        request(second.base, "POST", "/api/checkouts", duplicate, cookieB),
      ]);
      assert.deepEqual(
        [left.status, right.status].sort(),
        [200, 201],
        JSON.stringify([left, right]),
      );
      assert.equal(left.data.order.id, right.data.order.id);
      const spareRead = await request(
        second.base,
        "GET",
        "/api/products",
        undefined,
        cookieB,
      );
      assert.equal(
        spareRead.data.products.find(
          (item) => item.id === spare.data.product.id,
        ).reserved,
        1,
      );

      await stop(first);
      first = undefined;
      await stop(second);
      second = undefined;
      restarted = await start(dbPath);
      const persisted = await request(
        restarted.base,
        "GET",
        `/api/orders/${left.data.order.id}`,
        undefined,
        cookieA,
      );
      assert.equal(persisted.status, 200, JSON.stringify(persisted.data));
      const replay = await request(
        restarted.base,
        "POST",
        "/api/checkouts",
        duplicate,
        cookieA,
      );
      assert.equal(replay.status, 200);
      assert.equal(replay.data.order.id, left.data.order.id);
    } finally {
      await Promise.all([stop(first), stop(second), stop(restarted)]);
      await rm(dir, { recursive: true, force: true });
    }
  },
);
