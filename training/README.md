# Training — Stockade (astra5)

Batch B05, tier **DRILL**. Built against `main` @ `7a9e422`. Scope: Phase 3 (blind review + 1 incident) plus a
mini Phase 5 interview kit (project stories + 10 technical questions). No ladder/, navigation/, or agentic/ —
those are LAB-tier only and this project wasn't tiered as LAB for this batch.

Batch focus: **sagas and compensation across a polyglot boundary** (Next.js caller ↔ .NET "Fulfil" service).
Both artifacts below turn on the same real design property of this codebase: the payment saga is coordinated
across Postgres and Stripe by a polling reconciliation loop with no framework, using bare strings as its
state vocabulary.

## Suggested order (~2.5–3.5 hours total)

1. **`review/EXERCISE.md`** (60 min, timed) — blind review of the Worker/Commerce/Payments/Transactions
   boundary. Write your findings before opening anything sealed.
2. **`review/COMPARE.md`** (15–20 min) — fill in after opening `_answers/review.md`. This step is where the
   actual learning happens; don't skip it.
3. **`incidents/001-payment-status-drift.md`** (30–45 min) — an on-call brief with no hint of the cause. Do
   steps 1–6 before opening `_answers/incidents/001-payment-status-drift.md`.
4. **`interview/TECHNICAL_QUESTIONS.md`** (30–40 min) — 10 questions, half of them specifically "sagas vs. 2PC
   vs. outbox" using this codebase's actual code, not generic definitions.
5. **`interview/PROJECT_STORIES.md`** (30 min) — write your own STAR stories once 1–4 are done; they depend on
   what you found.

## What's real vs. planted

- The review (`review/` + `_answers/review.md`) is a read of the **unmodified, committed** codebase at `HEAD`.
  Finding 1 in `_answers/review.md` (the two-transaction capture/compensate split in `Worker.cs`) is a **real,
  pre-existing bug in this repo**, not planted — it was found by reading the code, and it's the strongest
  finding in the review for exactly that reason.
- INC-001 is a **planted, minimal, realistic diff** (one line, `services/Fulfil/Services/Payments.cs:79`) on
  branch `training/incidents/001-payment-status-drift` (commit `5b0a209`, based on `HEAD`). `dotnet build`
  passes on the branch (`services/Fulfil` builds clean, 0 warnings/errors — verified). The main working tree
  was never touched to create it (worktree-based, per the apprenticeship agent brief).

## Files

```
training/
  review/
    EXERCISE.md          — timed blind-review prompt
    COMPARE.md            — fill in after seeing the sealed answer
  incidents/
    001-payment-status-drift.md   — on-call brief, no hint of cause
  interview/
    PROJECT_STORIES.md    — 5 STAR-story prompts (fill in yourself)
    TECHNICAL_QUESTIONS.md — 10 questions, 5 on sagas/2PC/outbox specifically
  _answers/
    review.md                                    — sealed: 16 ranked findings
    incidents/001-payment-status-drift.md         — sealed: root cause, mechanism, fix, regression test, postmortem
```

## Curriculum links (read first, don't re-derive)

- `apprenticeship/curriculum/01-transactional-outbox.md` — the outbox pattern used for
  webhook/email delivery (`Worker.Deliver`), contrasted against the payment saga's polling-loop design in
  `TECHNICAL_QUESTIONS.md` Q4.
- `apprenticeship/curriculum/02-idempotency.md` — backs `Data/Transactions.cs`'s `Command()` idempotency-key
  handling and `Commerce.Release`'s reservation-state guard.
- `apprenticeship/curriculum/14-load-backpressure-timeouts.md` — relevant to review finding 12 (per-merchant
  fairness in the `Expire` sweep) and the bounded `Take(20)`/`Take(50)` batches throughout `Worker.cs`.

## Existing learning-doc trees in this repo (verdicts)

| Tree | What it is | Verdict |
|---|---|---|
| `astradocs/` (6 files, committed) | Career/roadmap-style docs (CODE_WALKTHROUGHS, SWE_ROADMAP, PROJECT_SUMMARY, etc.) | **KEEP** — distinct style from this batch's exercise-based material, no overlap; link from the competency graph, don't merge |
| `astraupskill/` (untracked — one of the 9 uncommitted paths, not touched by this pass) | Generic 8-chapter template shared across the astra family (01-CODEBASE-MAP … 07-TRACE-LAB), plus `evidence/`/`snapshots/` tied to the user's in-progress refund-health feature (the other 8 uncommitted files) | **IGNORE for this pass** — it's the user's own uncommitted work-in-progress, not archive material; revisit once it's committed |
| `docs/` (11 files: ARCHITECTURE, SECURITY, API, CONTRACT_LOG, PERFORMANCE, RUNBOOK, etc.) | Real engineering docs, not teaching material | **KEEP as-is** — out of scope for training/, these are product docs; `docs/SECURITY.md` is cited directly in `_answers/review.md` finding 16 as a strength to imitate |

## Caveats

- `dotnet build` was run only for the incident branch (`services/Fulfil`, isolated worktree) — not the main
  tree, and not `npm ci`/the TS test suite (no npm install was run in this pass; the working tree's own
  uncommitted TS changes — `src/lib/health.ts`, `tests/health.test.ts` — were left untouched per the
  hard rule, and running `npm ci`/`npm test` risked interacting with those in-progress files, so it was
  skipped rather than risk a false read on unrelated work). If you want the TS side verified, run
  `npm ci && npm test` yourself in a clean checkout.
- Review finding 1 (the split-transaction stuck saga) and INC-001 (contract drift) are deliberately different
  bugs so the review and the incident don't just restate each other — but they share a root cause class
  (no durable, atomic saga-step boundary + no compiler-checked state contract), which is the point: name it
  explicitly if it comes up in `interview/`.
- 15–30 findings were requested for the review; 16 were written, each with real file/line evidence. Some are
  small on purpose (per the master prompt: "it's fine if some are small").
