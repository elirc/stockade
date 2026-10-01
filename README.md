# Stockade — local commerce operations

A JavaScript commerce simulator built through Astra implementation, Sol adversarial review, and independent browser verification. Read the [build narrative](journal/READ-ME-FIRST.txt) to follow the choices, objections, fixes, and evidence. This is part two of a three-project course — see the [curriculum overview](../CURRICULUM.md).

## Upskilling guides

Start with the [learning path](journal/LEARNING-PATH.md), then work through:

- [Eight fictional user stories](journal/USER-STORY-WALKTHROUGHS.md): customer requests, acceptance criteria, implementation steps, review challenges, and proposed payment/multi-warehouse extensions.
- [Architecture clinic](journal/ARCHITECTURE-CLINIC.md): transaction boundaries, stock constraints, request identity, prices, expiry, migrations, and infrastructure tradeoffs.
- [Practice workbook](journal/PRACTICE-WORKBOOK.md): nine labs with answer guides, a partial-refund capstone with an implementation tier, and prompts for adversarial review roles.
- [Review fixes as diffs](journal/diffs/review-fixes.md): the session-aging and stale-tab-logout findings reconstructed as study-able changes.

The fictional scenarios explain the code and explore future features. The original build narrative and verification report retain the actual history and evidence.

## Read the implementation

The backend carries short comments at its invariant points (the `onHand >= reserved >= 0` conservation rule, checkout key + fingerprint semantics, the expected-account middleware whose registration order is load-bearing, expiry as an in-transaction state transition): [src/app.js](src/app.js), [src/database.js](src/database.js). The browser client is plain ES modules with no build step, loaded from [public/app.js](public/app.js) (dialog guards, polling, boot):

- [public/api.js](public/api.js) — the one fetch wrapper and the displayed-account intent header
- [public/state.js](public/state.js) — application state, identity tokens, and checkout-key persistence
- [public/dom.js](public/dom.js) — markup helpers, escaping, formatting
- [public/session.js](public/session.js) — session reconciliation, login, business switching
- [public/views.js](public/views.js) — workspace shell, catalog, inventory, orders, activity
- [public/cart.js](public/cart.js) — cart and checkout with lost-response key recovery
- [public/dialogs.js](public/dialogs.js) — order actions, product and stock-adjustment forms

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

`npm test` now also runs [tests/expiry-race.test.js](tests/expiry-race.test.js), a deterministic expiry-versus-payment race suite added with the 2026-10-01 upskilling expansion (workbook lab 8); the verification report documents the original build's evidence, and this suite is additional coverage, not part of that record. Test runs regenerate `test-results/`; the preserved record of the original build lives in `journal/evidence/`. `.github/workflows/ci.yml` runs the three verification commands on GitHub when this folder is pushed as its own repository.

The main contention test starts **two server processes**, sends 500 checkouts for 100 units, and checks every outcome plus persisted stock. This is a local correctness experiment, not a production capacity claim.

`PORT`, `DB_PATH`, and `RESERVATION_TTL_MS` configure the server. The default reservation lifetime is five minutes. To back up data, stop the app before copying its `data` directory, including any SQLite sidecars. Existing GitHub repositories and sibling rebuilds are unchanged.

This edition does not implement real payments, shipping integrations, tax calculation, discounts, multiple warehouses, a public storefront, or production identity. Those are separate architecture exercises, not hidden completed features.
