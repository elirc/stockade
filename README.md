# Stockade — local commerce operations

A JavaScript commerce simulator built through Astra implementation, Sol adversarial review, and independent browser verification. Read the [build narrative](journal/READ-ME-FIRST.txt) to follow the choices, objections, fixes, and evidence.

## Upskilling guides

Start with the [learning path](journal/LEARNING-PATH.txt), then work through:

- [Eight fictional user stories](journal/USER-STORY-WALKTHROUGHS.txt): customer requests, acceptance criteria, implementation steps, review challenges, and proposed payment/multi-warehouse extensions.
- [Architecture clinic](journal/ARCHITECTURE-CLINIC.txt): transaction boundaries, stock constraints, request identity, prices, expiry, migrations, and infrastructure tradeoffs.
- [Practice workbook](journal/PRACTICE-WORKBOOK.txt): six labs with answer guides, a partial-refund capstone, and prompts for adversarial review roles.

The fictional scenarios explain the code and explore future features. The original build narrative and verification report retain the actual history and evidence.

## Run

Requires Node 22.16+ with `node:sqlite`.

```powershell
cd C:\Users\Owner\Desktop\astrafinalorganize\stockade-rebuild
npm ci
npm start
```

Open **http://127.0.0.1:4318**. Dependencies are already installed in this copy. Choose Northstar Supply or Daybreak Goods. Each demo account has a separate business and inventory. Changes persist in `data/` across restarts. SQLite's experimental warning on Node 22.16 is expected.

## Explore

- Browse the catalog, build a cart, and reserve an order with server-calculated prices.
- Simulate payment approval or decline; ship paid orders; cancel unexpired reservations; refund shipped orders with optional restocking.
- Add products and adjust physical inventory with stale-version protection.
- Inspect orders and activity; switch businesses to exercise data isolation.
- Leave a reservation unpaid until expiry and inspect the released stock.

Payments and refunds are **local simulations**. No real payment provider is contacted and no money moves. Demo accounts have no passwords; anyone using the local app can choose either business. Do not publish this as a commerce service without replacing authentication and payment infrastructure.

Inventory vocabulary: `onHand` is physical stock, `reserved` is held for unshipped orders, and `available = onHand - reserved`. Paid orders still hold stock. Shipping reduces physical and reserved quantities together. Cancellation, decline, and expiry release a reservation; a restocking refund adds physical stock once.

Checkout keys identify purchase intent. Retrying the same intent returns the same order in its **current** lifecycle state. Reusing the key for different items returns a conflict. A canceled order's old key never creates a new hold.

## Verify and read

```powershell
npm run check
npm test
npm run test:browser
```

A compatible Playwright Chromium is already available on this laptop; a fresh machine may need `npx playwright install chromium`. Tests use isolated databases, not your saved demo data. See [verification](journal/VERIFICATION.md), [architecture](ARCHITECTURE.md), and [contract](CONTRACT.md).

The main contention test starts **two server processes**, sends 500 checkouts for 100 units, and checks every outcome plus persisted stock. This is a local correctness experiment, not a production capacity claim.

`PORT`, `DB_PATH`, and `RESERVATION_TTL_MS` configure the server. The default reservation lifetime is five minutes. To back up data, stop the app before copying its `data` directory, including any SQLite sidecars. Existing GitHub repositories and sibling rebuilds are unchanged.

This edition does not implement real payments, shipping integrations, tax calculation, discounts, multiple warehouses, a public storefront, or production identity. Those are separate architecture exercises, not hidden completed features.
