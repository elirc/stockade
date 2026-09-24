# Sealed review — Stockade / Fulfil

Reviewed at `HEAD` = `7a9e422` ("Build Stockade core, Phase 2 workflows, and AstraDocs"). Working-tree-only
files (README.md, scripts/integration.mjs, services/Fulfil/Services/ReadApi.cs, src/components/Panels.tsx,
astraupskill/, scripts/test-refund-health.py, src/lib/health.ts, tests/Fulfil.Tests/RefundHealthTests.cs,
tests/health.test.ts) are the user's own uncommitted work and are **not** in scope or referenced below.

Severity order: production correctness/data-integrity first, then security, then concurrency/failure
handling, then performance/operability, then tests/maintainability.

---

## 1. (HIGH — saga/compensation, silent, no recovery) A captured-despite-void order can get permanently
stuck outside the recovery loop and outside the app's own health metric

`Worker.cs`, `ProcessOrder`, the `void_pending` branch (`Worker.cs:65-79`):

```csharp
if (order.PaymentState == "void_pending")
{
    if (order.ProviderId != null)
    {
        var remoteVoid = await payments.Retrieve(order.ProviderId); ValidatePayment(order, remoteVoid);
        if (remoteVoid.State == "captured")
        {
            await CompleteCapture(tx, id, ct);                      // <-- commits as its own transaction
            await tx.Run(async db => { ... await Commerce.Release(db, o); ...
                Rules.Transition(o, "cancelled"); Emit(...); return true; }, ct);   // <-- second, separate transaction
            return;
        }
        ...
```

`CompleteCapture` (`Worker.cs:129-137`) runs `tx.Run(...)` and **commits on its own**: it sets
`o.PaymentState = "captured"`, transitions the order to `"paid"`, and moves reservations from `reserved` to
`held`. The *next* statement is a **second**, independent `tx.Run(...)` that releases stock, queues a refund,
and transitions the order to `"cancelled"`.

If the process is killed, redeployed, or the pod is rescheduled between these two commits (a routine event —
this is exactly the crash window sagas exist to survive), the order is left with `PaymentState = "captured"`,
`State = "paid"`, stock held, no refund queued, and the customer was charged for an order the storefront told
them was cancelled.

It does not self-heal:
- The recovery scan (`Worker.cs:24`) only re-picks orders whose `PaymentState` is in
  `{"pending","authorizing","authorized","capturing","unknown","action_required","void_pending"}`. `"captured"`
  is not in that set, so this order is **never scanned again**.
- `Attempts` is only incremented by `Unknown()` (`Worker.cs:125`), which this path never calls, so the
  order's own `Attempts` counter stays at 0.
- The app's own operability signal for this exact failure mode — `GET /api/v1/data/health` →
  `stuckSagas: db.Orders.CountAsync(x.Attempts >= 12)` — will **never count this order**, because it never
  accumulates attempts. The dashboard's "Stuck payments" tile (`src/components/Panels.tsx` health panel) would
  show 0 while money sits uncompensated.

Why it matters: this is the textbook saga failure mode (partial execution across a crash boundary with no
compensating step that is itself durable/idempotent as a *unit*), and it is invisible to every alarm the app
ships with. A senior fix would make the capture-confirm-then-compensate sequence a single transaction (feasible
here — no external I/O happens between them, `Commerce.Release` and `ReserveRefund` are pure DB) or, if it must
stay two transactions, write a durable "compensation pending" marker in the *same* transaction as
`CompleteCapture` and have the recovery scan include it.

## 2. (HIGH — contract drift, silent misrouting) Payment-state vocabulary is a bare, duplicated string with no
shared source of truth

The internal state `"action_required"` is produced in exactly one place — `Payments.Parse`
(`Payments.cs:78-79`, mapping Stripe's raw `"requires_action"` → `"action_required"`) — but consumed as a
literal string in at least five other locations that must all agree:

- `Rules.cs:32-33` — the transition table keys/values
- `Worker.cs:24` — the recovery-scan filter
- `Worker.cs:88, 94, 107, 132` — four separate `==`/assignment sites in the reconciliation loop
- `Integrations.cs:154` — the Stripe webhook handler's wake-up condition

There is no enum, no shared constant, nothing the compiler checks. A one-word rename in `Parse` (e.g. to match
Stripe's own dashboard vocabulary, or a copy-paste typo) compiles cleanly and silently breaks every downstream
site that still expects the old string — see `INC-001` for exactly this failure, planted and reproduced.

Compounding this: `Payments.Parse` is **only called when `Payments:Mode=Stripe`** (`Payments.cs:19-30, 32-39,
40-44`, each guarded by `if (Mode == "Simulator") { ...; return ...; }` *before* reaching `Parse`). Local dev
and CI almost certainly run with the simulator (see finding 3), so this is the one boundary in the whole saga
that the test suite structurally cannot exercise.

## 3. (MED-HIGH — test coverage / old-AI-generated smell) The one payment-provider translation function has
zero test coverage, and the test suite can't reach it without configuration

`grep -r "action_required\|Parse" tests/Fulfil.Tests` finds no reference to `Payments.Parse` or to the
`action_required` state anywhere in the test suite. Because `Parse` only runs under `Payments:Mode=Stripe`
(finding 2), and nothing in `tests/Fulfil.Tests` or `compose.yaml` sets that mode, the tests are structurally
incapable of catching a regression in the provider-status mapping — the exact bug in `INC-001`. This is the
classic "tests are green" smell: coverage looks fine by count, but the highest-risk boundary (an external
provider's vocabulary meeting the app's internal vocabulary) has none.

## 4. (MED — correctness/UX at the checkout↔storage boundary) A duplicate checkout submission can exhaust 16
retries and surface a raw Postgres error instead of a friendly conflict

`Orders` has `HasIndex(x => new { x.MerchantId, x.CheckoutKey }).IsUnique()` (`StockadeDb.cs:58`).
`Transactions.Run` (`Transactions.cs:19-20`) treats Postgres SQLSTATE `23505` (unique violation) as
**retryable**, same as a serialization failure (`40001`) or deadlock (`40P01`):

```csharp
static bool Retryable(Exception ex) => ex is PostgresException p && p.SqlState is "40001" or "40P01" or "23505" || ...
```

`23505` on `CheckoutKey` is not a transient race — it is the DB telling you a *business-level* duplicate
already exists. `Checkout()` (`Commerce.cs:86-125`) builds a brand-new `Order` (new `Guid`, same
`CheckoutKey`) on every call, so retrying the whole action re-attempts the exact same insert and fails again,
every time, for all 16 attempts (`Transactions.cs:14`), then rethrows the raw `PostgresException` — which the
Next.js proxy (`src/app/api/[...path]/route.ts`) will forward as a 500 with a Postgres error body, not the
`DomainError`-shaped `{code, error}` the SDK (`src/lib/stockade-sdk.ts:36`) knows how to parse. A network-retry
double-submit (not even malicious) gets a broken error screen instead of "you already have a quote for this
cart."

## 5. (MED — saga/idempotency, worth confirming under load rather than assumed) `Commerce.Release` is
guarded correctly today, but nothing stops a future change from breaking that guard silently

`Commerce.Release` (`Commerce.cs:146-156`) filters on `x.State != "released" && x.State != "fulfilled"` before
touching `Inventory.Reserved`/`Held`, which is what makes it safe to call twice (once from `Cancel`'s
interactive path, once from `Worker`'s `void_pending` path, and from the `remoteVoid.State == "captured"`
path in finding 1). That correctness rests entirely on this one filter and is not covered by a dedicated test
that calls `Release` twice in a row and asserts stock is unchanged the second time — the property that matters
is currently implicit, not verified. (See `training/ladder`-style exercise idea in the curriculum-needs
section of the batch report — not built here, DRILL tier.)

## 6. (MED — operability) The background worker's own health signal undercounts exactly the failure mode it
exists to catch

Same evidence as finding 1: `stuckSagas` (`ReadApi.cs`, `ToDo` health handler) counts `Attempts >= 12`, but
`Attempts` is a *retry* counter incremented only on transient failure (`Unknown()`, `Worker.cs:125`). A saga
that got wedged because a commit sequence was interrupted (not because a payment call failed) never
increments `Attempts` and never shows up. A more useful signal would independently flag orders whose
`PaymentState` is outside the recoverable set *and* whose `State`/`Captured`/`Refunded`/`RefundPending`
invariant looks inconsistent (e.g. `Captured > 0 && State == "cancelled" && RefundPending == 0 && Refunded <
Captured`).

## 7. (MED — concurrency, correct today but fragile) `SessionLease` unlocks *all* advisory locks on its
connection, not just the one it took

`Worker.cs:44-55`: `SessionLease.DisposeAsync` runs `SELECT pg_advisory_unlock_all()` rather than unlocking
the specific `hashtextextended(@key,0)` lock it acquired. This is safe *today* only because `Lease()` always
opens a brand-new `NpgsqlConnection` per call (`Worker.cs:39`) and nothing else shares it. The moment anyone
"optimizes" `Lease` to reuse a pooled connection or takes two leases on one connection (e.g. to lease
`order:{id}` and `outbox:{id}` together), `unlock_all` will silently release a lock some *other* concurrent
operation still believes it holds — a correctness landmine left for a future refactor.

## 8. (MED — data integrity, easy to miss) `Reallocate` reads `old.Held` and mutates it outside `Move`/the
ledger, unlike every other stock-touching path

`Commerce.Reallocate` (`Commerce.cs:201-225`) directly does `old.Held -= remaining;` and `stock.Held += q;`
without going through `Move()` (which writes an `Adjustment` audit row). Every other inventory mutation in the
codebase (`Ship`, `Adjust`, transfers, purchases, counts) leaves an `Adjustment` row for the ledger that
`Reconciliation.Run` (`Reconciliation.cs`) cross-checks against. `Reallocate` doesn't touch `OnHand`, so it's
arguably out of `Adjustments`' scope by design — but it also leaves no `OrderEvent`/audit trail per line moved,
only one summary `Event(db, order, "reallocated", ...)` at the end. If a reallocation partially fails
(`reallocation_shortage`, line 221) after some reservations were already flipped to `released` /
re-`held`, there's no line-level record of which ones moved before the exception — harder to reconcile by hand
than every other partial-failure path in this file.

## 9. (MED — security, defense-in-depth gap) The Stripe webhook handler resolves the target order by
`ProviderId` alone, with no merchant check before touching `PaymentAttempts`/`Attempts`

`Integrations.cs:136-161`, `api.MapPost("/stripe/webhook", ...)`: after signature verification (good — HMAC +
timestamp window, fixed-time compare, `Verify` at `Integrations.cs:18-24`), the handler does
`db.Orders.SingleOrDefaultAsync(x => x.ProviderId == provider)` with no merchant filter, then mutates
`order.Attempts`/`order.UpdatedAt` directly. This is fine as long as `ProviderId` values are provider-issued
and globally unique (they are, for Stripe), so it is not exploitable today, but it means the webhook path is
the one place in the codebase that does **not** carry a `MerchantId` scope check the way every other query in
`ReadApi`/`Commerce` does (compare `VisibleOrder`, `Get<T>`, every `x.MerchantId == a.MerchantId` filter
elsewhere). Worth a comment explaining the invariant it relies on, since the next person to copy this pattern
for a lower-uniqueness provider ID won't have that guarantee.

## 10. (MED — failure handling) A `PaymentDeclined` during void produces an `"unknown"` order with no
distinguishing detail from a genuinely ambiguous provider response

`Worker.cs:111-115`, the `catch (PaymentDeclined ex)` block: if `payments.Void(order)` itself throws (e.g. the
provider is unreachable while trying to void an authorization), the code calls `Unknown(tx, id, ex.Message,
ct)` — the same bucket used for "we don't know if the provider's authorize/capture actually happened." An
on-call engineer reading `order.Error` later cannot tell "we don't know if we charged them" from "we tried to
cancel a charge we know didn't happen and the cancel call itself failed" without re-deriving it from
`PaymentAttempts` history. A distinct state (or at least a distinct `Error` prefix) would save a diagnostic
step every time this path fires.

## 11. (LOW-MED — performance) `ReadApi.List` pays for a full `CountAsync()` on every paginated "orders" and
"inventory" fetch in addition to the page query

`ReadApi.cs`, `resource == "orders"` and `resource == "inventory"` branches both do
`await rows.Skip(...).Take(size).ToListAsync()` **and** `await rows.CountAsync()` — two round trips, and the
count query re-scans the same filtered set. At current seed-data scale this is invisible; on a merchant with
a large order history (the natural "table grows" scenario this app is built to survive, per
`docs/PERFORMANCE.md`) it's the first thing to show up in a slow-endpoint trace. Cheap fix: make `total`
optional (only computed on the first page, or via `EstimateCount`-style approach) rather than every request.

## 12. (LOW-MED — index gap) `Reservations` is indexed on `(State, ExpiresAt)` but not scoped by `MerchantId`

`StockadeDb.cs:61`: `b.Entity<Reservation>().HasIndex(x => new { x.State, x.ExpiresAt });` backs the `Expire()`
sweep (`Worker.cs:152-167`, `db.Reservations.Where(x => x.State == "reserved" && x.ExpiresAt < DateTime.UtcNow)`)
across **all merchants at once**, ordered arbitrarily by index, then joined per-row back to `Orders` by
`SingleAsync`. Fine at demo scale; at real multi-tenant scale one noisy merchant's reservation churn competes
for the same index range as every other tenant's expiry sweep, and there's no `Take` fairness — it's `Take(50)`
globally per tick (`Worker.cs:157`), so a busy tenant can starve a quiet one's expirations.

## 13. (LOW — maintainability) `Commerce.Dispatch`'s 30-branch `switch` expression is the only place that
enumerates every command; `CommandInputs` in `stockade-sdk.ts` is a second, hand-maintained enumeration that
must be kept in sync by hand

`Commerce.cs:12-52` (C# dispatch table) and `stockade-sdk.ts:3-18` (`CommandInputs` interface) both list
command names and payload shapes independently, with no generated or shared source. Today they happen to
agree; there is nothing that would fail a build if they drifted (e.g. a new C# command added without an SDK
entry just can't be called from the typed client, but there's no compile-time or CI check flagging the gap).
This is the same *class* of risk as finding 2 (contract drift) at the command-shape level rather than the
state-enum level.

## 14. (LOW — test/operability) No test exercises the two-transaction `CompleteCapture` → `Release`+refund
sequence under a simulated crash

Confirms finding 1 is not just theoretical: nothing in `tests/Fulfil.Tests` calls `CompleteCapture` and then
asserts what happens if the *next* `tx.Run` never executes (e.g. by invoking `CompleteCapture` directly and
checking `Order`/`Inventory`/`Refund` state without also running the release step). A regression test for
finding 1 would need to do exactly that.

## 15. (LOW — maintainability / old-AI-generated smell, harmless) Leftover scratch files from commit
automation

`.git/gk` and `.git/stockade-commit-message.txt` (outside the reviewed source tree, inside `.git/`) look like
artifacts of a scripted commit step, not source. Harmless, but worth a `.gitignore`/cleanup pass if this
becomes a template for future runs — otherwise a future clone or `git gc` may behave oddly around a
non-standard file sitting in `.git/`.

## 16. (LOW — documentation honesty, a strength worth naming) `docs/SECURITY.md` self-discloses exactly the
kind of gap this review exists to probe

`docs/SECURITY.md:8`: "External review still required for verified identity/promotion abuse... This checklist
is not a claim those checks passed." This is the opposite of the typical old-AI-generated smell (docs claiming
things the code doesn't do) — flag it as a strength to imitate, not a finding to fix.

---

## Old-AI-generated smells specifically (cross-reference)

- **Tests that can't reach the riskiest code path** — finding 3 (Payments.Parse under Simulator mode).
- **A duplicated, un-enforced contract** — findings 2 and 13 (string vocabulary, command shape).
- **A correctness invariant that is implicit rather than tested** — findings 5 and 14 (Release idempotency,
  the two-transaction capture sequence).
- Notably *absent* here compared to most projects in this batch: no fake/stubbed integrations pretending to be
  real (the Stripe integration is real, gated behind `sk_test_` keys and `Payments:AllowSimulator`,
  `Payments.cs:58, SimulatorGuard`), no hardcoded secrets, no missing transaction boundaries on the command
  path (`Transactions.Command` is used consistently), no reskinned boilerplate. This is one of the
  cleaner projects reviewed in this batch; the findings above are mostly the kind of thing that only shows up
  under a deliberately adversarial saga/crash-boundary read, not a first pass.
