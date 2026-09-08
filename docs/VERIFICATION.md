# Verification evidence
Date: 2026-09-08. Local Windows workstation, PostgreSQL 17 in Docker, Node 22, .NET 10. Simulator payments only.

## Final source checks
- Release backend assembly and domain tests: **27 passed, 0 failed**.
- Frontend unit tests: **5 passed** across money, persistent command retry identity, and allowed/denied request origins.
- Optimized Next production build: **passed**, including TypeScript and every route.
- PowerShell startup parser and Docker Compose configuration validation: **passed**.
- Local API health and production Next startup: **passed** at 127.0.0.1:5080 and 127.0.0.1:3000.

## PostgreSQL functional acceptance
All **13 functional checks passed** on the final backend:
1. Tenant and customer authorization boundaries.
2. Non-mutating quotes, command replay, payload conflict and captured payment.
3. Partial fulfillment, return claim limits and one-time restocking.
4. Non-mutating exchange quote, changed-price rejection and one replacement purchase.
5. Transfer holds, dispatch, partial/duplicate receipt, loss and conservation.
6. Supplier partial/duplicate receipts, over-receipt rejection and cancellation.
7. Stale counts, self-approval rejection and independent correction.
8. Concurrent refunds bounded by captured funds.
9. Declined payment releases its reservation.
10. Ledger, commitment and transfer-transit reconciliation.
11. API key scope checks and immediate revocation.
12. Deterministic product-scoped promotion stacking.
13. Database rejection of oversells and append-only history rewrites.

The final combined run proceeded into contention and then failed, so it did not overwrite the older artifacts/integration-results.json. That older file records the earlier 12-check pass, not this final run. Console results above are summarized separately in artifacts/final-verification.json. The runner was then corrected to write fresh reports on both success and failure; its syntax check passed.

## Unresolved contention gate
The exact requirement remains **500 parallel attempts, 100 units, 100 accepted orders and 400 sold-out responses**, with no negative availability.
- First run: 30 HTTP 200 and 470 HTTP 500 from serialization retry exhaustion.
- Added bounded per-resource admission before serializable snapshots, explicit database lease release, pooled connection bounds and fewer allocation queries.
- Final rerun: all 13 functional checks passed, but the 500-request run failed with UND_ERR_HEADERS_TIMEOUT (the client's five-minute response limit). It did not produce a complete response distribution.
- Post-run snapshot for the new hot fixture: physical 100, reserved 2, held 20; available 78. The worker may subsequently move reserved to held. Nonnegative snapshots do not prove the required load outcome.
- Root cause and throughput under the target deployment remain unresolved. Do not treat this as an oversell-test or performance pass. Profile queue time, database round trips, worker contention and host resource use; retain the original acceptance criteria.

## Browser evidence
Production Chrome run: storefront persistence/keyboard bag and mobile-width checks passed. Merchant navigation reached Inventory but its data stayed loading beyond the 30-second assertion while contention ran.
**Isolated final production Chrome rerun: all three journeys passed** (cart persistence and keyboard bag, merchant login/inventory/transfer form, and 390px mobile fit). The merchant check keeps the same functional assertions with a 120-second local data wait. This does not establish responsiveness under load.
The valid-origin cart failure from an earlier run was fixed, covered by unit tests and confirmed by the passing persistence journey.
Desktop screenshot was visually inspected. Synthetic test variants were deactivated after the database run; history was retained.

## External evidence not established
Authentic Stripe test-mode challenge/capture/refund, full two-instance 5000-attempt/3M-order/200k-SKU benchmark, target resource limits and expiry lag, full-container image execution, restore drill on target infrastructure, independent security/code review, merchant interviews, real product measures, elapsed pilot observation and human competence remain unverified. See OPEN_THREADS.md and UPSKILLING.md.


## AstraDocs handoff validation
Created six AstraDocs guides covering the full implementation, worked code paths, a 48-68 hour SWE learning roadmap, prioritized next tickets and a reusable learning log. Validated 84 local Markdown links, balanced fences, document titles and the stock/money/learning-hour arithmetic. Artifact: artifacts/astradocs-validation.json.

Corrected the TypeScript SDK order.cancel input to require reason, matching captured-order cancellation/refund handling. This changes the compile-time input contract; callers must supply the reason. It does not change runtime payment or inventory behavior. npm run typecheck passed after the change.

The earlier production build and 27 backend / five frontend / 13 functional database / three browser results were carried forward, not rerun during this documentation pass. The contention gate remains unresolved; no production, Stripe, independent review or learner competence claim changed.
