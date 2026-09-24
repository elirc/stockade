# Blind code review — Stockade / Fulfil

Time box: **60 minutes.** Read `main` (`HEAD` = `7a9e422`), not the uncommitted working-tree files listed below.

## Scope

Focus your review on the polyglot boundary between the Next.js storefront/admin (`src/`) and the C#/.NET
"Fulfil" service (`services/Fulfil/`), specifically:

- `services/Fulfil/Services/Worker.cs` — the background saga/reconciliation loop (order payment lifecycle,
  refund lifecycle, outbox delivery, reconciliation scheduling)
- `services/Fulfil/Services/Commerce.cs` — the command dispatcher (checkout, cancel, ship, refund, transfers,
  purchases, counts)
- `services/Fulfil/Services/Payments.cs` — the boundary that translates a payment provider's raw status
  strings into Stockade's internal payment-state vocabulary
- `services/Fulfil/Services/Integrations.cs` — API keys, webhook signing/delivery, the Stripe webhook handler
- `services/Fulfil/Domain/Rules.cs` — the order-state transition table
- `services/Fulfil/Data/Transactions.cs` — the transaction/retry/idempotency helper every command runs through
- `services/Fulfil/Data/StockadeDb.cs` — indexes, unique constraints, CHECK constraints
- `src/app/api/[...path]/route.ts` and `src/lib/stockade-sdk.ts` — how the Next.js side talks to Fulfil

**Do not review the 9 files that are already modified/untracked in the working tree** (`git status`) — those
are the user's own in-progress work, not part of this exercise.

## What to produce

A findings list, ranked **most → least severe**, in your own words. For each finding:

1. One-line summary
2. File(s) and evidence (quote or cite the exact line(s))
3. Why it matters in production (money, data integrity, availability, or security — be concrete: what
   breaks, for whom, under what condition)
4. Whether it's a correctness bug, a missing safeguard, a design trade-off worth flagging, or a maintainability
   smell

Aim for 15+ findings across: correctness, security, concurrency, failure handling (sagas/compensation), data
integrity, performance, operability, tests, and maintainability. It's fine if some are small.

## Specific angles worth pulling on (don't skip these)

- Trace what happens to an `Order` when `PaymentState` becomes `"void_pending"` (`Worker.cs`, the
  `ProcessOrder` method) and the process **crashes or restarts** partway through handling it. Which DB writes
  landed? Which didn't? Would the background loop ever pick this order up again? Would `GET /api/v1/data/health`
  (`stuckSagas`) ever flag it?
- The string `"action_required"` (and its siblings `"authorized"`, `"captured"`, `"void_pending"`, etc.) is
  typed as a bare C# `string`, not an enum, and is compared with `==` in at least 5 places across 3 files.
  What happens the day someone renames one occurrence and not the others? Would any test catch it? (Check
  which `Payments.cs` code paths run under `Payments:Mode=Simulator`, which is what local dev and CI almost
  certainly use, vs. `Payments:Mode=Stripe`.)
- `Orders` has a unique index on `(MerchantId, CheckoutKey)` (`StockadeDb.cs`). `Transactions.Run` retries any
  `23505` (unique-violation) as if it were a transient serialization conflict. Walk through what happens when
  a browser double-submits the exact same checkout twice with the same `CheckoutKey`.
- Compare `Commerce.Cancel` (interactive command, one transaction) against `Worker.ProcessOrder`'s
  `void_pending` handling (background, **two separate transactions** — look for two separate calls to
  `tx.Run`/`await tx.Run(...)` inside the same branch). What guarantees the second one ever runs?

## When done

Fill in `training/review/COMPARE.md` with your findings vs. the sealed answer, then open
`training/_answers/review.md`.
