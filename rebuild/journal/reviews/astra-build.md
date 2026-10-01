# Astra implementation journal — Stockade

## Scope and initial decisions

Built the contract as a local commerce operations simulator, with Express 5.2.1, Node's SQLite interface, vanilla browser JavaScript, and Playwright 1.63.0. Root owns narrative/browser verification and Sol owns independent adversarial and contention tests. I did not edit those files or sibling projects.

The inventory model distinguishes physical stock from reservations: checkout adds only to reserved; payment retains the hold; shipment removes both; cancellation, expiry, and decline release the hold; a shipped-order refund may add physical stock once. Product versions advance on every inventory change, so an adjustment based on quantities before a reservation is correctly stale.

All writes that affect commerce run in `BEGIN IMMEDIATE`, with WAL and a 30-second busy timeout. This serializes competing writers across processes through SQLite, not a JavaScript mutex. Each stock movement has an inventory-ledger entry; human-readable activity is in the same transaction. Seed data is installed only at schema version 0, promoted to version 1, and subsequent starts preserve operational state.

Checkout keys are tenant-scoped. The fingerprint sorts distinct product IDs and normalizes numeric IDs; supplied prices and totals are rejected. A replay returns the same order's current lifecycle state. Replaying an old cancelled/expired order never creates another hold. Failed multiline checkouts roll back entirely. Physical stock has an explicit upper bound of 1,000,000,000 units, including adjustments and refund restoration.

Expiry needs special care: a state action first expires reservations inside its write transaction, then returns a conflict marker instead of throwing within the transaction for a now-unavailable action. The HTTP 409 is produced after commit. This prevents a rejected late payment from rolling expiry back and reviving the hold.

## Security and local boundaries

Opaque random cookies are stored as hashes, with HttpOnly and SameSite=Strict, and a Stockade-specific name. Tenant authorization comes from the session account. Host is restricted to localhost/127.0.0.1 and writes require an application-specific request header plus a matching Origin when one is sent. Sessions are local passwordless demo identities, explicitly described as such in the UI. Payments and refunds are explicitly simulated and never request card data.

Server input validation rejects NULs, nonprimitive IDs, unsupported fields, unsafe integers, duplicate lines, excessive text, and invalid SKU formats. Text written into browser HTML is escaped. JSON bodies allow escaped versions of maximum-length descriptions without exceeding the parser budget.

## Actual reviews and corrections

Sol reported that session `created_at` was being stored without an age check. I added a 24-hour lifetime enforced against the injected clock, including rejection of invalid stored dates. Sol's added regression failed before this correction and passed afterward, as reported in the independent review.

Root's UI source review identified stale refresh responses across business switches, concurrent demo-login clicks, delayed order reads replacing newer dialogs, closing mutation dialogs while responses were pending, and discarding an uncertain checkout key through cart edits. I added account epochs, refresh sequence checks, dialog request identities, a shared login gate, mutation-time dialog controls/Escape/backdrop guards, and persistent unresolved checkout state. An uncertain checkout freezes its original intent and exposes “Recover checkout”; a retry uses the same key and cart. Definite client errors unlock editing. Per-account browser storage keeps different demo carts separate.

Sol also raised a cross-tab cookie switch hazard: a stale page could display business 1 while its shared session cookie now selected business 2. Root requested a write precondition. Browser commerce reads and writes now carry `X-Stockade-Account`; the server rejects a mismatch with `409 ACCOUNT_CHANGED` before any business operation. Session endpoints remain available for identity reconciliation. Refresh checks session identity before and after its data batch. A changed identity reloads the page, cancelling old document work and restoring the matching account's saved cart. The optional header remains compatible with independent API callers.

The UI uses cream, forest, and rust, a responsive sidebar, product illustrations drawn as local SVG markup, searchable catalog/inventory/orders, a real cart, order transition controls, product creation, compare-and-swap inventory adjustments, and an activity ledger. It makes no external asset requests. Mobile collapses navigation and stacks the cart below the catalog.

## Builder verification

Initial in-memory HTTP smoke created a session and a two-unit order successfully. `npm run check` passed after initial UI construction. Builder core tests exercise the complete reserve/pay/ship/refund path and ledger uniqueness, replay after cancellation, expiry at the exact deadline, stale-version and activity-trigger rollback, plus validation/Host/Origin/request-header boundaries. Independent concurrency results belong to Sol's journal; browser outcomes belong to root's evidence rather than being claimed here in advance.

The first core run passed four tests and failed the Host assertion because Node fetch did not send the requested forged Host. I changed that transport-specific assertion to `node:http`, which can send an actual hostile Host, rather than weakening server behavior.

The corrected builder core run passed 5/5. The syntax check passed again after the asynchronous UI and cross-tab corrections (9 JavaScript files at that point). Source was handed to root for independent delayed-response browser regressions, final integration testing, and readability formatting.

## Final stale-tab logout correction

Sol identified that the expected-account middleware followed `DELETE /api/session`. Root reproduced the consequence in the sixth UI-race scenario: a stale tab's business-switch action returned 204 and revoked the session another tab had selected. The first five race scenarios had passed. I moved DELETE registration below the expected-account guard. The browser helper already sends `X-Stockade-Account` on DELETE requests, so no browser header change was necessary. GET session still bypasses the precondition for reconciliation; initial POST session remains available before authentication.

After this correction I ran root's unchanged `node tests/ui-races.mjs`: all 6/6 scenarios passed, including stale-tab logout retaining the newly selected business session. No additional source edits followed that run.

## Tradeoffs

This is a local learning edition. SQLite synchronous operations deliberately favor simple, inspectable transaction semantics over event-loop concurrency. The local two-process load test establishes the specified inventory gate; it is not a production benchmark. There are no payment providers, remote APIs, production identity, taxes, shipping labels, email, or returns logistics. The 30-second UI poll refreshes idle views; active forms and dialogs remain stable. Reservation expiry is enforced on relevant reads/transitions and by the running server's ten-second sweep.
