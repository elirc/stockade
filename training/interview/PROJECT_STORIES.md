# Project stories — Stockade / Fulfil

Complete these yourself, in your own words, after doing the review (`training/review/`) and the incident
(`training/incidents/001-payment-status-drift.md`). Use the STAR shape (Situation, Task, Action, Result).
Every story must cite a real file/line from this repo — no generic phrasing.

## 1. Debugging story — the invisible stuck saga

Prompt: "Tell me about a time you found a bug that wouldn't have shown up in normal testing."

Use finding 1 from `training/_answers/review.md` (the two-transaction `CompleteCapture` → `Release`+refund
sequence in `Worker.cs`'s `void_pending` branch) or INC-001 (the `Payments.Parse` contract drift). Write:
what made you look at that code path in the first place, what evidence convinced you it was really broken
(not just theoretically), and what you'd tell a teammate to check for next time.

## 2. Trade-off story — sagas without a saga framework

Prompt: "Walk me through a distributed-transaction design decision you'd defend."

Stockade coordinates state across Postgres (source of truth) and Stripe (external, cannot be transactional
with Postgres) using: an advisory-lock lease per order (`Worker.cs:37-43`), a bounded reconciliation loop
polling every 1.5s (`Worker.cs:34`), and idempotency keys on every interactive command
(`Data/Transactions.cs:24-43`). Explain why this system doesn't use two-phase commit, what specifically makes
that choice correct here (which system is authoritative, what "isolation level" you fall back to across the
boundary), and where it costs you (see finding 1 — the two-commit split is exactly where the lack of atomicity
across steps bites).

## 3. Incident story — the recovery loop that didn't recover

Prompt: "Describe an incident and what changed afterward (process, not just code)."

Use INC-001. Cover: what the alert/symptom actually was (there wasn't a real alert — support noticed), why
`stuckSagas` didn't catch it, and what you'd add to the health check so the *next* silently-dropped saga
(not necessarily this exact bug) gets caught by monitoring before a customer does.

## 4. Migration/consistency story — reconciliation as a second source of truth

Prompt: "How do you know your data is actually correct, not just that no error was thrown?"

Use `Reconciliation.Run` (`services/Fulfil/Services/Reconciliation.cs`) — it independently recomputes
`OnHand`/`Reserved`/`Held` from the `Adjustments` ledger and `Reservations`/`Transfers` tables and diffs
against the live `Inventory` row, once per merchant per day (`Worker.cs:211-224`, `ReconcileDue`). Explain
what class of bug this catches that unit tests can't (drift accumulated over many small mutations across
`Move`, `Release`, `Reallocate`, transfers, and purchases), and what it *wouldn't* catch (anything that's wrong
in both the ledger and the live row the same way).

## 5. Agent-caught-bug story (optional — do after `training/incidents/`)

If you used an AI coding agent anywhere in this apprenticeship pass (finding the review issues, drafting the
regression test in `training/_answers/incidents/001-payment-status-drift.md`), describe one place the agent's
first answer was wrong or incomplete, how you caught it, and what you checked to be sure your correction was
actually right rather than just different.
