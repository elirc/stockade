# Technical questions — Stockade / Fulfil

All 10 reference this codebase directly. Answer in writing before checking anything against
`training/_answers/review.md` or `training/_answers/incidents/`.

## Sagas vs. two-phase commit vs. outbox (this project's core design)

1. Stockade's checkout reserves stock and creates an `Order` in one Postgres transaction
   (`Commerce.Checkout`, `Commerce.cs:86-125`), then authorizes payment with Stripe *outside* any DB
   transaction, later, from the background worker (`Worker.ProcessOrder`, `Worker.cs:80-90`). Why not hold the
   DB transaction open across the Stripe call instead — i.e., why is this a saga (a sequence of local
   transactions coordinated by compensation) and not one big ACID transaction? What concretely would go wrong
   if you tried to make it one transaction?

2. Two-phase commit (2PC) *would* give you atomicity across Postgres and a payment provider if both supported
   the XA protocol. Stripe doesn't. Even if it did — name one operational reason a saga is usually still
   preferred over 2PC for a call to an external HTTP API (think about what a "prepare" phase means when the
   coordinator or the participant can be down for minutes, not milliseconds).

3. `Worker.cs`'s `void_pending` branch (see `training/_answers/review.md`, finding 1) calls `CompleteCapture`
   and then a **separate** `tx.Run(...)` to release stock and queue a refund. That's two local transactions
   for what should be one saga step. Redesign it: could this be one transaction? If yes, say exactly what
   would need to be inside vs. outside the transaction boundary (remember: at that point in the code, the
   Stripe call has *already happened* — `remoteVoid` was already fetched). If you think it genuinely can't be
   one transaction, explain the constraint that forces the split.

4. The outbox pattern (`OutboxEvent`, `Worker.Deliver`, `Worker.cs:168-210`) is used for webhook/email
   delivery, not for the payment saga itself. Why does the payment lifecycle use a polling
   reconciliation loop with advisory-lock leases (`Worker.cs:37-43`) instead of an outbox? What property does
   an outbox give you (order, at-least-once, decoupling producer from consumer) that the payment loop doesn't
   need, and what does the payment loop need (idempotent *external* retries against a stateful remote
   resource) that a plain outbox message wouldn't capture on its own?

5. Define "compensating transaction" using this codebase's own example: what compensates for a successful
   stock reservation (`Checkout`) if the payment is later declined? Trace the exact code path
   (`Worker.cs`, `catch (PaymentDeclined ex)` block) and name the specific compensating action. Then: is that
   compensation idempotent — i.e., what happens if it runs twice for the same order? Cite the guard that makes
   it safe (or unsafe).

## API design / contracts

6. `src/lib/stockade-sdk.ts`'s `CommandInputs` interface and `Commerce.Dispatch`'s switch
   (`Commerce.cs:12-52`) are two independently hand-maintained lists of the same command set (review finding
   13). Propose one concrete mechanism (not "write more tests" — something structural) that would make these
   two drift-proof, or explain why it's not worth the engineering cost at this project's size.

## Database / data integrity

7. `StockadeDb.cs` puts a CHECK constraint on `Inventory` (`"OnHand" - "Reserved" - "Held" >= 0`) *and* the
   application code (`Commerce.Move`) checks `stock.Available + delta < 0` before writing. Why have the
   invariant enforced in two places? Under what concrete sequence of events does the CHECK constraint save you
   when the application-level check alone would not have?

## React / frontend

8. `src/app/api/[...path]/route.ts` proxies every request to Fulfil and forwards `Set-Cookie` headers
   (`.getSetCookie()`/`.append('Set-Cookie', ...)`) back to the browser. What CSRF and cookie-scoping
   properties does this proxy design get you "for free" compared to having the browser call Fulfil directly
   cross-origin, and what does it cost you (think: what does Fulfil's `Session`/auth code have to trust about
   this specific proxy that it couldn't trust about an arbitrary caller)?

## Testing

9. `Fulfil.Tests` was green through the exact regression in `INC-001`. Design the smallest test (say in one
   or two sentences, not full code) that would have caught it, and explain why it needs to *not* run under
   `Payments:Mode=Simulator` to do so.

## Operations

10. `GET /api/v1/data/health` reports `stuckSagas` as `Attempts >= 12`. Propose a second, independent signal
    (a query, not a vague idea) that would have caught the orders in INC-001, which never had `Attempts`
    incremented at all. What table(s)/columns would it read, and what would make it a *reliable* signal rather
    than another metric nobody trusts?
