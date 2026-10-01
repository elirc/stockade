# Stockade local JavaScript rebuild

Complete local commerce operations simulator. No real payments, email, external APIs, or production identity. Own folder only; do not touch sibling rebuilds or old organizer. Node 22.16+, ES modules, Express 5.2.1, node:sqlite, vanilla browser JS/CSS; Playwright 1.63.0 for browser checks. Default port 4318, loopback binding. Persistent SQLite under data/, ignored. Seed idempotently at schema version1. Root owns journal/READ-ME-FIRST.txt, README, ARCHITECTURE, final evidence and tests/browser.mjs; Astra builder owns implementation/package and tests/core.test.js; Sol owns tests/adversarial.test.js, tests/contention.test.js, journal/reviews/sol*.md. Builder records actual decisions in journal/reviews/astra-build.md.

## Product and integrity

Two isolated demo businesses, each with an operator account, selected at demo login. All exposed business APIs require an opaque HttpOnly SameSite cookie tied to tenant, not caller-supplied tenant authorization. Never pretend these passwordless identities are production auth. Reject wrong Host and cross-origin writes; require X-Stockade-Request:1 for mutations. All untrusted text escaped in UI and validated in server; reject NUL, nonprimitive IDs, unsafe money/quantity integers. JSON bounded but accommodates max fields. Errors {error,code,current?}. API statuses 400 validation,401 absent session,404 cross-tenant IDs,409 business conflict,503 contention. No fake UI buttons.

Persistent products {id,sku,name,description,priceCents,onHand,reserved,available,version}; available=onHand-reserved, always >=0. All stock integers. Products tenant-scoped. Inventory adjustment uses mandatory product version CAS and cannot lower onHand below reserved. Each operation and its audit/ledger records commit together. Checkout uses BEGIN IMMEDIATE and conditional stock changes, never stale read-then-write without lock. Multi-line checkout all-or-nothing. Price totals calculated server-side from current catalog and snapshotted on line items. Input price/total overrides rejected.

Order states: reserved -> paid -> shipped -> refunded; reserved -> cancelled/expired/declined. Checkout reserves stock without reducing onHand. Successful fake payment retains reservation. Shipping decrements both onHand and reserved. Cancel/expiry/decline release reservation exactly once. Refund allowed only after shipped; simulated full refund can optionally restock once. All repeated state actions must either return existing result or409 without duplicating effects. Fake payments are explicit local state transitions in the same DB, not claims about a remote payment-provider transaction. Inventory ledger/activity explains each transition.

Checkout requires client idempotencyKey, scoped to tenant. Same normalized intent replays same order even if stock now exhausted; different intent with reused key409. Failed checkout must leave no partial inventory/order. Active reservations expire after configurable TTL (default5min); paid orders do not expire. Use app clock injection for deterministic expiry tests, and periodic sweep for real running server. Lookup/replay and reservation are one transaction. No process-local lock used as the only stock guarantee. Logs must not expose cookies.

## Stable API for UI and independent tests

GET /api/health -> {ok:true}
GET /api/demo-accounts -> {accounts:[{id,name,businessName}]}; seed IDs1=Northstar Supply,2=Daybreak Goods
POST /api/session {accountId} -> {account}; GET /api/session -> {account}; DELETE /api/session ->204
GET /api/products -> {products}; POST /api/products {sku,name,description?,priceCents,onHand} ->201 {product}
PATCH /api/products/:id/stock {version,delta,reason} -> {product}; signed integer delta, positive/negative, cannot oversell
POST /api/checkouts {idempotencyKey,items:[{productId,quantity}]} ->201 {order}, replay200 {order}; duplicate productIDs rejected; max20distinctlines,quantity1..1000
GET /api/orders -> {orders}; GET /api/orders/:id -> {order,events}
POST /api/orders/:id/pay {outcome:'approved'|'declined'} -> {order}
POST /api/orders/:id/ship {} -> {order}
POST /api/orders/:id/cancel {} -> {order}
POST /api/orders/:id/refund {restock:boolean} -> {order}
POST /api/maintenance/expire {} -> {expiredCount}
GET /api/activity -> {events} newest100
GET /api/summary -> {productCount,availableUnits,reservedUnits,paidRevenueCents,orderCount}

Order {id,number,status,totalCents,createdAt,expiresAt,items:[{productId,sku,name,quantity,unitPriceCents,lineTotalCents}],...}; order IDs may be integer or UUID but consistent. Events {id,orderId?,action,detail,createdAt}. Dates ISO. maxname120,description4000,sku2..32uppercasealphanumeric/hyphen,reason300. Money priceCents1..100000000; check safe totals. Product version increment on stock/reservation changes.

Export createApp({dbPath=':memory:',clock=()=>Date.now(),reservationTtlMs=300000,logger=console}) -> {app,db,close,expireReservations}. src/server.js accepts PORT=0,DB_PATH,RESERVATION_TTL_MS; prints `Stockade ready http://127.0.0.1:PORT`. Graceful shutdown. Browser catalog/cart checkout, order detail with real state actions, inventory create/adjust, ledger/activity, tenant switch, filters/search and sensible error/replay recovery; warm cream + rust/forest operations dashboard, responsive/mobile.

## Required adversarial proof

Two independent Node server processes share a fresh DB with a test SKU of100units. Fire500one-unit checkouts with unique keys, split betweenprocesses. Exactly100 accepted and400sold-out conflicts, no500/timeouts/negative inventory, reserved100. Concurrent same-key requests replay oneorder and reserve once. Other tests: cross-tenantID denial, multilinestockrollback, CAS adjustments, expiry versus payment, repeatedship/refund no doubles, activityfailure rollback and restartpersistence. Document actual latency without calling the local result a productionbenchmark.
