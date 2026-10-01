import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "../src/app.js";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const output = join(root, "test-results");
await mkdir(output, { recursive: true });
let current = Date.now();
const instance = createApp({ clock: () => current, reservationTtlMs: 60000 });
const server = instance.app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let browser, page;
const results = [],
  runtimeErrors = [];
async function check(name, work) {
  try {
    await work();
    results.push({ name, status: "passed" });
    console.log("PASS " + name);
  } catch (error) {
    results.push({ name, status: "failed", error: error.message });
    throw error;
  }
}
async function api(path, body, method = "POST") {
  return page.evaluate(
    async ({ path, body, method }) => {
      const response = await fetch(
        "/api" + path,
        body === undefined
          ? {}
          : {
              method,
              headers: {
                "Content-Type": "application/json",
                "X-Stockade-Request": "1",
              },
              body: JSON.stringify(body),
            },
      );
      return {
        status: response.status,
        data: response.status === 204 ? null : await response.json(),
      };
    },
    { path, body, method },
  );
}
async function navigate(view) {
  await page.getByRole("button", { name: view, exact: true }).click();
}
async function closeDialog() {
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector("#dialog").open);
}
async function orderState(status) {
  await page.waitForFunction(
    (s) =>
      document
        .querySelector("#dialog .order-meta .status")
        ?.textContent.toLowerCase() === s,
    status,
  );
}
async function reserve(name = "Everyday canvas tote") {
  await navigate("Catalog");
  await page
    .getByRole("button", { name: `Add ${name} to cart`, exact: true })
    .click();
  await page.locator("#checkout").click();
  await orderState("reserved");
}
try {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : {}),
  });
  page = await browser.newPage({ viewport: { width: 1500, height: 1050 } });
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  let productId;
  await check("login, catalog and desktop layout", async () => {
    await page.goto(base);
    await page.locator('[data-login="1"]').click();
    await page.locator(".product").first().waitFor();
    assert.equal(await page.locator(".product").count(), 6);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    await page.screenshot({
      path: join(output, "desktop-catalog.png"),
      fullPage: true,
    });
  });
  await check(
    "create priced product and inventory with escaped description",
    async () => {
      await navigate("Inventory");
      await page.locator("#new-product").click();
      await page
        .getByLabel("Product name", { exact: true })
        .fill("Review field kit");
      await page.getByLabel("SKU", { exact: true }).fill("REVIEW-KIT");
      await page.getByLabel("Price (USD)", { exact: true }).fill("12.34");
      await page.getByLabel("Opening units", { exact: true }).fill("5");
      await page
        .getByLabel("Description", { exact: true })
        .fill('<img src=x onerror="window.injected=true"> A useful kit.');
      await page
        .getByRole("button", { name: "Create product", exact: true })
        .click();
      await page.waitForFunction(() => !document.querySelector("#dialog").open);
      const product = (await api("/products")).data.products.find(
        (p) => p.sku === "REVIEW-KIT",
      );
      productId = product.id;
      assert.equal(product.priceCents, 1234);
      assert.equal(product.onHand, 5);
      await navigate("Catalog");
      await page
        .getByRole("searchbox", { name: "Search catalog" })
        .fill("review-kit");
      assert.equal(await page.locator(".product").count(), 1);
      assert.equal(await page.evaluate(() => window.injected), undefined);
    },
  );
  await check(
    "inventory adjustment handles concurrent stock change without losing draft",
    async () => {
      await navigate("Inventory");
      await page
        .getByRole("button", { name: "Adjust Review field kit stock" })
        .click();
      await page.getByLabel("Change in units").fill("2");
      await page
        .getByLabel("Reason", { exact: true })
        .fill("Counted two additional kits");
      const before = (await api("/products")).data.products.find(
        (p) => p.id === productId,
      );
      assert.equal(
        (
          await api(
            `/products/${productId}/stock`,
            {
              version: before.version,
              delta: 1,
              reason: "Other operator received stock",
            },
            "PATCH",
          )
        ).status,
        200,
      );
      await page
        .getByRole("button", { name: "Save adjustment", exact: true })
        .click();
      await page.getByText(/Stock changed while you were editing/).waitFor();
      assert.equal(await page.getByLabel("Change in units").inputValue(), "2");
      assert.equal(
        (await api("/products")).data.products.find((p) => p.id === productId)
          .onHand,
        6,
      );
      await page
        .getByRole("button", { name: "Save adjustment", exact: true })
        .click();
      await page.waitForFunction(() => !document.querySelector("#dialog").open);
      assert.equal(
        (await api("/products")).data.products.find((p) => p.id === productId)
          .onHand,
        8,
      );
    },
  );
  await check(
    "reserve, simulated payment, shipment, and restocking refund conserve inventory",
    async () => {
      await reserve("Review field kit");
      let product = (await api("/products")).data.products.find(
        (p) => p.id === productId,
      );
      assert.deepEqual(
        [product.onHand, product.reserved, product.available],
        [8, 1, 7],
      );
      await page
        .getByRole("button", { name: "Simulate approved payment", exact: true })
        .click();
      await orderState("paid");
      assert.equal(
        (await api("/products")).data.products.find((p) => p.id === productId)
          .reserved,
        1,
      );
      await page
        .getByRole("button", { name: "Mark as shipped", exact: true })
        .click();
      await orderState("shipped");
      product = (await api("/products")).data.products.find(
        (p) => p.id === productId,
      );
      assert.deepEqual([product.onHand, product.reserved], [7, 0]);
      await page.screenshot({
        path: join(output, "order-timeline.png"),
        fullPage: true,
      });
      await page
        .getByRole("button", { name: "Simulate full refund", exact: true })
        .click();
      await orderState("refunded");
      assert.equal(
        (await api("/products")).data.products.find((p) => p.id === productId)
          .onHand,
        8,
      );
      await closeDialog();
    },
  );
  await check(
    "cancel and simulated decline each release their hold once",
    async () => {
      const before = (await api("/products")).data.products.find(
        (p) => p.id === 1,
      ).available;
      await reserve();
      await page
        .getByRole("button", { name: "Cancel order", exact: true })
        .click();
      await orderState("cancelled");
      await closeDialog();
      await reserve();
      await page
        .getByRole("button", { name: "Simulate decline", exact: true })
        .click();
      await orderState("declined");
      await closeDialog();
      assert.equal(
        (await api("/products")).data.products.find((p) => p.id === 1)
          .available,
        before,
      );
    },
  );
  await check(
    "expired reservation refuses payment and displays released state",
    async () => {
      await reserve();
      current += 60001;
      await page
        .getByRole("button", { name: "Simulate approved payment", exact: true })
        .click();
      await orderState("expired");
      await page.getByRole("alert").waitFor();
      await closeDialog();
    },
  );
  await check(
    "lost checkout response retries the stored key without a second reservation",
    async () => {
      await navigate("Catalog");
      const before = (await api("/orders")).data.orders.length;
      let first = true;
      const handler = async (route) => {
        if (!first) return route.continue();
        first = false;
        await route.fetch();
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({
            error: "Injected lost response after commit",
            code: "BUSY",
          }),
        });
      };
      await page.route("**/api/checkouts", handler);
      try {
        await page
          .getByRole("button", {
            name: "Add Everyday canvas tote to cart",
            exact: true,
          })
          .click();
        await page.locator("#checkout").click();
        await page.getByText(/Injected lost response/).waitFor();
        assert.equal((await api("/orders")).data.orders.length, before + 1);
        assert.equal(
          await page.locator("[data-remove]").first().isDisabled(),
          true,
        );
        assert.equal(
          await page.locator("[data-quantity]").first().isDisabled(),
          true,
        );
        await page.reload();
        await page
          .getByRole("button", { name: "Recover checkout ↗", exact: true })
          .waitFor();
        assert.equal(
          await page.locator("[data-remove]").first().isDisabled(),
          true,
        );
        await page.locator("#checkout").click();
        await orderState("reserved");
        assert.equal((await api("/orders")).data.orders.length, before + 1);
        await closeDialog();
      } finally {
        await page.unroute("**/api/checkouts", handler);
      }
    },
  );
  await check(
    "orders, activity, reload persistence and isolated business switching",
    async () => {
      await navigate("Orders");
      assert.ok((await page.locator("[data-order]").count()) >= 5);
      await navigate("Activity");
      assert.match(await page.locator("#results").textContent(), /refunded/);
      await page.reload();
      await page.locator(".product").first().waitFor();
      assert.ok((await page.locator("[data-product-id]").count()) >= 7);
      await page
        .getByRole("button", { name: "Switch business", exact: true })
        .first()
        .click();
      await page.locator('[data-login="2"]').click();
      await page.locator(".product").first().waitFor();
      assert.equal(await page.locator(".product").count(), 3);
      const denied = await api(
        `/products/${productId}/stock`,
        { version: 1, delta: 1, reason: "Cross-business attempt" },
        "PATCH",
      );
      assert.equal(denied.status, 404);
    },
  );
  await check("mobile catalog and keyboard dialog dismissal", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    await page.screenshot({
      path: join(output, "mobile-catalog.png"),
      fullPage: true,
    });
    await navigate("Inventory");
    await page.locator("#new-product").click();
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.querySelector("#dialog").open);
  });
  assert.deepEqual(runtimeErrors, []);
  console.log(
    `${results.length}/${results.length} Stockade browser scenarios passed.`,
  );
} catch (error) {
  await page
    ?.screenshot({ path: join(output, "failure.png"), fullPage: true })
    .catch(() => {});
  console.error(error);
  process.exitCode = 1;
} finally {
  await writeFile(
    join(output, "browser-results.json"),
    JSON.stringify(
      { timestamp: new Date().toISOString(), results, runtimeErrors },
      null,
      2,
    ),
  );
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
  instance.close();
}
