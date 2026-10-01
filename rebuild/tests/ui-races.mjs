import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "../src/app.js";
const out = join(
  dirname(dirname(fileURLToPath(import.meta.url))),
  "test-results",
);
await mkdir(out, { recursive: true });
const instance = createApp(),
  server = instance.app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}`,
  results = [],
  errors = [];
let browser, page;
const network = [];
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
async function check(name, work) {
  try {
    await work();
    results.push({ name, status: "passed" });
    console.log("PASS " + name);
  } catch (e) {
    results.push({ name, status: "failed", error: e.message });
    throw e;
  }
}
async function hold(pattern, method = "GET") {
  const entered = deferred(),
    release = deferred(),
    done = deferred();
  let used = false;
  const handler = async (route) => {
    if (used || route.request().method() !== method) return route.continue();
    used = true;
    const response = await route.fetch();
    entered.resolve();
    await release.promise;
    await route.fulfill({ response });
    done.resolve();
  };
  await page.route(pattern, handler);
  return {
    entered: entered.promise,
    release: async () => {
      release.resolve();
      if (used) await done.promise;
      await page.unroute(pattern, handler);
    },
  };
}
async function settle() {
  await page.evaluate(
    () =>
      new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
}
async function switched(id) {
  await page
    .getByRole("button", { name: "Switch business", exact: true })
    .first()
    .click();
  await page.locator(`[data-login="${id}"]`).click();
  await page.locator(".product").first().waitFor();
}
async function api(target, path, body) {
  return target.evaluate(
    async ({ path, body }) => {
      const res = await fetch(
        "/api" + path,
        body === undefined
          ? {}
          : {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-Stockade-Request": "1",
              },
              body: JSON.stringify(body),
            },
      );
      return { status: res.status, data: await res.json() };
    },
    { path, body },
  );
}
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  page = await context.newPage();
  page.on("request", (request) =>
    network.push({
      event: "request",
      method: request.method(),
      path: new URL(request.url()).pathname,
    }),
  );
  page.on("response", (response) =>
    network.push({
      event: "response",
      status: response.status(),
      path: new URL(response.url()).pathname,
    }),
  );
  page.on("requestfailed", (request) =>
    network.push({
      event: "failed",
      path: new URL(request.url()).pathname,
      error: request.failure()?.errorText,
    }),
  );
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base);
  await check(
    "pending login prevents a competing account selection",
    async () => {
      const held = await hold("**/api/session", "POST");
      try {
        await page.locator('[data-login="1"]').click();
        await held.entered;
        assert.equal(await page.locator('[data-login="2"]').isDisabled(), true);
        await held.release();
        await page.locator(".product").first().waitFor();
      } finally {
        await held.release();
      }
    },
  );
  await check(
    "late refresh cannot show the previous business under the next account",
    async () => {
      await page.getByRole("button", { name: "Activity", exact: true }).click();
      const held = await hold("**/api/products");
      try {
        await page.locator("#refresh-activity").click();
        await held.entered;
        await switched(2);
        await held.release();
        await settle();
        assert.match(await page.locator(".business").textContent(), /Daybreak/);
        assert.equal(await page.locator(".product").count(), 3);
      } finally {
        await held.release();
      }
      await switched(1);
    },
  );
  await check(
    "delayed order response cannot replace the later selected order",
    async () => {
      const one = (
        await api(page, "/checkouts", {
          idempotencyKey: "order-a",
          items: [{ productId: 1, quantity: 1 }],
        })
      ).data.order;
      const two = (
        await api(page, "/checkouts", {
          idempotencyKey: "order-b",
          items: [{ productId: 2, quantity: 1 }],
        })
      ).data.order;
      await page.reload();
      await page.locator(".product").first().waitFor();
      await page.getByRole("button", { name: "Orders", exact: true }).click();
      const held = await hold(`**/api/orders/${one.id}`);
      try {
        await page.locator(`[data-order="${one.id}"]`).click();
        await held.entered;
        await page.locator(`[data-order="${two.id}"]`).click();
        await page
          .getByRole("heading", { name: two.number, exact: true })
          .waitFor();
        await held.release();
        await settle();
        assert.equal(
          await page.locator("#dialog h2").textContent(),
          two.number,
        );
        await page.getByRole("button", { name: "Close dialog" }).click();
      } finally {
        await held.release();
      }
    },
  );
  await check(
    "pending product write blocks dismissal and duplicate submit",
    async () => {
      await page
        .getByRole("button", { name: "Inventory", exact: true })
        .click();
      await page.locator("#new-product").click();
      await page
        .getByLabel("Product name", { exact: true })
        .fill("Acknowledged product");
      await page.getByLabel("SKU", { exact: true }).fill("ACK-PRODUCT");
      await page.getByLabel("Price (USD)", { exact: true }).fill("10");
      const held = await hold("**/api/products", "POST");
      try {
        await page
          .getByRole("button", { name: "Create product", exact: true })
          .click();
        await held.entered;
        assert.equal(
          await page.getByRole("button", { name: "Close dialog" }).isDisabled(),
          true,
        );
        await page.keyboard.press("Escape");
        assert.equal(
          await page.locator("#dialog").evaluate((d) => d.open),
          true,
        );
        await held.release();
        await page.waitForFunction(
          () => !document.querySelector("#dialog").open,
        );
      } finally {
        await held.release();
      }
    },
  );
  await check(
    "shared-cookie account switch rejects a stale tab write and reconciles its identity",
    async () => {
      const stale = await context.newPage();
      stale.on("pageerror", (e) => errors.push(e.message));
      try {
        await stale.goto(base);
        await stale.locator(".product").first().waitFor();
        await stale
          .getByRole("button", { name: "Inventory", exact: true })
          .click();
        await stale.locator("#new-product").click();
        await stale
          .getByLabel("Product name", { exact: true })
          .fill("Must not cross businesses");
        await stale.getByLabel("SKU", { exact: true }).fill("CROSS-TAB");
        await stale.getByLabel("Price (USD)", { exact: true }).fill("10");
        await switched(2);
        const rejected = stale.waitForResponse(
          (r) =>
            r.url().endsWith("/api/products") &&
            r.request().method() === "POST",
        );
        await stale
          .getByRole("button", { name: "Create product", exact: true })
          .click();
        assert.equal((await rejected).status(), 409);
        await stale.waitForFunction(() =>
          document.querySelector(".business")?.textContent.includes("Daybreak"),
        );
        assert.equal(
          (await api(page, "/products")).data.products.some(
            (p) => p.sku === "CROSS-TAB",
          ),
          false,
        );
      } finally {
        await stale.close();
      }
    },
  );
  await check(
    "stale tab logout cannot revoke the newly selected business session",
    async () => {
      await switched(1);
      const stale = await context.newPage();
      stale.on("pageerror", (e) => errors.push(e.message));
      try {
        await stale.goto(base);
        await stale.locator(".product").first().waitFor();
        await switched(2);
        const rejected = stale.waitForResponse(
          (r) =>
            r.url().endsWith("/api/session") &&
            r.request().method() === "DELETE",
        );
        await stale
          .getByRole("button", { name: "Switch business", exact: true })
          .first()
          .click();
        assert.equal((await rejected).status(), 409);
        await stale.waitForFunction(() =>
          document.querySelector(".business")?.textContent.includes("Daybreak"),
        );
        assert.equal((await api(page, "/session")).data.account.id, 2);
      } finally {
        await stale.close();
      }
    },
  );
  assert.deepEqual(errors, []);
  console.log(
    `${results.length}/${results.length} Stockade UI race scenarios passed.`,
  );
} catch (e) {
  await page
    ?.screenshot({ path: join(out, "race-failure.png"), fullPage: true })
    .catch(() => {});
  console.error(e);
  process.exitCode = 1;
} finally {
  await writeFile(
    join(out, "ui-race-results.json"),
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        results,
        runtimeErrors: errors,
        network,
      },
      null,
      2,
    ),
  );
  await browser?.close();
  await new Promise((r) => server.close(r));
  instance.close();
}
