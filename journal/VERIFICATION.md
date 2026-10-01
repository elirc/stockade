# Stockade verification

Final checks completed on 1 October 2026 after source formatting. Runtime: Windows, Node 22.16.0, Express 5.2.1, Playwright 1.63.0 and Chromium. Tests use isolated databases; saved demo data is separate.

| Command | Result |
| --- | --- |
| `npm run check` | 10 JavaScript files passed syntax checks |
| `npm test` | 13 passed, 0 failed, 0 skipped |
| `npm run test:browser` | 9 workflow scenarios plus 6 UI race scenarios passed; no browser runtime errors |

## What was demonstrated

- Two independent Node servers shared one SQLite database. Of 500 unique one-unit checkout requests against 100 units, exactly 100 returned 201 and 400 returned 409. The final run measured 5,900 ms for those requests, with no unexpected failures. Physical stock was 100, reserved stock 100, available stock 0. Timing describes this local run, not production capacity.
- A simultaneous same-key checkout created one order and reservation. Normalized intent, changed-intent rejection, current-state replay, and persistence across reopening the store passed.
- Multi-line atomicity, server-side pricing, expiry, payment/ship/refund replay, conflicting terminal actions, tenant isolation, stale stock versions, inventory caps and forced audit failure rollback passed.
- Browser workflows exercised catalog/product creation, escaped content, adjustment conflicts preserving drafts, reserve/pay/ship/refund, cancellation, decline, expiry, orders, activity, switching businesses, persistence, mobile layout and keyboard dialog dismissal.
- A browser test forwarded checkout to the real server and replaced its committed response with a 503. Cart controls stayed locked while the result was uncertain. Reload restored the saved key and recovery returned the same order without a second reservation.
- Held responses tested competing account selection, late refresh after switching accounts, delayed order details, and pending-write dismissal. Shared-cookie tests rejected stale-tab product writes and reconciled displayed identity.
- The stale-tab logout test initially observed HTTP 204 and revocation of the newly selected business session. Moving the expected-account precondition before DELETE session changed that result to 409 and preserved the new session. The unchanged test then passed.

Root visually inspected desktop and mobile screenshots. Actual agent reviews are retained under [reviews](reviews).

## Test reliability note

One final combined run timed out waiting for the catalog after releasing a held login response. No browser runtime error was reported. A diagnostic run with network tracing passed all six race scenarios; the following full browser command passed all 15 scenarios. Astra's read-only review found no deterministic cyclic await, and no application change was made for that timeout. Its underlying cause remains unconfirmed; it is not presented as a proven product repair. Network events are retained in the final race JSON to aid future diagnosis.

## Evidence and reproduction

Raw command output is in [evidence/backend-tests.txt](evidence/backend-tests.txt), [evidence/browser-tests.txt](evidence/browser-tests.txt), and [evidence/syntax.txt](evidence/syntax.txt). The evidence folder includes both browser result JSON files, screenshots, runtime details and SHA-256 hashes of the verified implementation and tests.

Run the commands above from this folder. Install dependencies with `npm ci`; if needed install the matching browser with `npx playwright install chromium`. Node 22.16 emits an expected experimental SQLite warning. PowerShell may wrap that stderr warning as a NativeCommandError in captured text; the final commands exited successfully and their assertions passed.

Payments/refunds are local SQL-backed simulations. These tests do not establish atomicity with an external payment provider, distributed scale, production authentication, or complete original-project feature parity. The account-intent header protects this browser from stale shared-cookie intent; server tenant authorization always derives from the authenticated session.
