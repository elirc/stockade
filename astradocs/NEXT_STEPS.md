# Next engineering steps

## Release decision and order of work

The local functional build is available. Public release remains **no-go** until the unresolved contention and other release gates have evidence. The initial 500/100 failure was serialization retry exhaustion; the rerun ended with a client header timeout. The investigation has not established a single root cause.

Do the work in this order: **A-01 -> A-02 -> A-03/A-04/A-05 -> A-06/A-07 -> A-08**. Product discovery and personal learning can run alongside diagnosis. The optional capstone follows the core correctness investigation. These are future tickets; their existence does not mean implementation or acceptance has passed.

Use the [verification record](../docs/VERIFICATION.md), [open threads](../docs/OPEN_THREADS.md), and [performance protocol](../docs/PERFORMANCE.md) as the baseline. Assign a real owner and due date when a ticket is started; role labels below are proposed responsibilities.

## A-01: establish a reproducible contention diagnosis

**Priority:** P0. **Status:** open. **Proposed owner:** SWE with database/performance review. **Initial investigation budget:** 2-4 hours; estimate a fix only after collecting evidence.

**Story:** As the engineer responsible for inventory correctness, I want a complete breakdown of queued checkout work so that I can fix the measured failure without weakening stock rules.

**Work:**

1. Record source revision or snapshot, runtime versions, database fixture, instance placement, workers, connection settings, CPU/RAM/I/O and client timeout.
2. Verify that the revised integration runner writes a fresh failure artifact with a failed check and nonzero exit. Its reporting change was only syntax-checked in the prior build.
3. Add or collect timings for authentication, admission wait, connection/lock acquisition, transaction queries, retries, commit, response and payment completion. Preserve request/run correlation.
4. Inspect database waits/query plans and pool behavior. Compare workers enabled/disabled only as labeled diagnostic variants.
5. Use small concurrency levels to locate a bottleneck. Do not relabel those as the 500-request acceptance run.
6. Keep the browser functional run separate; later measure admin responsiveness during the declared production load intentionally.

**Acceptance:** another engineer can reproduce the failure and review a report with exact conditions, complete available outcomes, missing outcomes identified, a ranked hypothesis, and the next experiment that could disprove it. Queue duration is included in latency. An incomplete response distribution stays failed/incomplete.

**Do not:** attribute the result solely to a slow host without measurements; increase retries or timeouts and declare success; discard slow/error requests; reduce the declared acceptance workload.

**Learning:** profiling, falsifiable hypotheses, observability and evidence-limited communication. Output: a dated investigation report and raw run artifacts.

## A-02: close the 500/100 gate

**Priority:** P0. **Status:** blocked by A-01 evidence, not by missing permission. **Proposed owner:** SWE plus reviewer familiar with transactional inventory.

Select the smallest change supported by A-01. Possible comparisons include query/round-trip reduction, admission design, database lock/update strategy, worker scheduling and connection budgeting. These are candidates, not diagnosed fixes.

**Acceptance:**

- Exactly 500 simultaneous one-unit attempts against a fresh 100-unit fixture produce exactly 100 accepted orders and 400 typed sold-out responses.
- Server and network failures are reported separately; they do not count as sold-out.
- No stock term or available value goes negative; reservation/hold/ledger reconciliation is clean.
- Retry/idempotency, refund and cross-workflow invariants remain intact.
- Capture/recovery outcomes are observed separately from request acceptance; do not infer financial completion from HTTP 200.
- Comparable fresh-fixture reruns demonstrate that the original intermittent failure is resolved. Preserve both before/after measurements and review the exact change.

A passing smaller gate is necessary but does not satisfy A-07. Do not replace serializable/database protection with an uncoordinated in-memory lock.

**Learning:** concurrency, performance/correctness tradeoffs and regression design.

## A-03: audit contracts and permissions across layers

**Priority:** P1. **Status:** targeted audit proposed. **Proposed owner:** SWE.

Build a matrix from story -> UI action -> typed input -> API scope/role -> domain guard -> persisted effect -> test. Start with paid-order cancellation, return decision versus receiving, warehouse-bound operations, count assignment/approval and integration credential management.

One concrete mismatch was corrected during this handoff: the SDK's order.cancel input now includes a required reason, matching the captured-order cancellation path. Existing typed callers must supply it. This is not evidence that all SDK/HTTP contracts have been audited.

**Acceptance:** required fields and units match the server; each listed role/key/scope has an explicit allow/deny expectation; negative tests prove no stock or financial effect; UI permissions communicate the command boundary. Resolve story/code mismatches through an explicit product/permission decision rather than silently broadening access.

**Learning:** API design, TypeScript contracts, authorization and cross-layer review.

## A-04: broaden recovery and customer-journey evidence

**Priority:** P1. **Status:** proposed. **Proposed owner:** SWE.

Add meaningful scenarios beyond the three current browser journeys: checkout to capture to partial shipment to eligible return; changed replacement total; duplicate receipt after a lost response; rejected claim freeing eligibility; offline warehouse resolution; and pending payment/refund recovery.

Introduce controlled failure points in an isolated test adapter where needed. Do not invent unsupported simulator payment-method names.

**Acceptance:** tests assert customer-visible state and persisted stock/financial effects, not just component rendering. A provider-effect/local-persistence crash recovers with one durable effect. Keyboard focus, submission errors, pending states and return eligibility are checked. Log any untested screen-reader or assistive-technology coverage separately.

**Learning:** integration testing, failure injection, asynchronous UX and customer communication.

## A-05: rehearse migration, recovery and runtime permissions

**Priority:** P1. **Status:** proposed; target environment needed. **Proposed owner:** SWE with database/operations review.

Use a newly named isolated database. Back up the database and preserve the Data Protection key ring and relevant configuration. Restore, apply schema changes, restart twice, verify version markers and reconcile. Inspect [Schema](../services/Fulfil/Data/Schema.cs), [Migrations](../services/Fulfil/Data/Migrations.cs) and the [runbook](../docs/RUNBOOK.md).

Create a migration-owner/runtime-role plan. The local shared account is not evidence of production least privilege.

**Acceptance:** the restore procedure is reproducible; decryption/session consequences of missing keys are understood; normal runtime credentials cannot perform DDL or rewrite protected history; opening/upgrade paths work on the target; reconciliation and representative journeys pass after restoration. Record compatibility limits for rollback.

**Learning:** database operations, schema evolution, durable secrets and recovery objectives.

## A-06: validate authentic Stripe test-mode behavior

**Priority:** P1. **Status:** external test credentials/callback configuration required. **Proposed owner:** SWE with payment integration review.

Use only a real Stripe test account and test keys. Keep secrets out of source and artifacts. This run is separate from load testing.

**Acceptance:** record authorization, challenge/action-required, capture, decline, void, refund, signed callback replay and timeout/reconciliation cases using actual test-provider evidence. Match order/provider identities and amount/currency; demonstrate no fulfillment before confirmed capture and no duplicate settlement on replay. Preserve an operational response for unknown outcomes.

**Learning:** integration contracts and distributed uncertainty. A simulator pass cannot close this ticket.

## A-07: execute the full performance and expiry protocol

**Priority:** P1. **Status:** after A-02 and a provisioned acceptance environment. **Proposed owner:** performance-capable SWE/operations reviewer.

Use the isolated database guard in [benchmark.mjs](../scripts/benchmark.mjs). Provision the declared data set and record/enforce the resource envelope. The two application instances must account for Next, API and worker placement; do not hide extra servers outside the budget.

**Acceptance:** the exact [protocol](../docs/PERFORMANCE.md) runs against three million historical orders, 200,000 variants, four warehouses, 20 hot variants/2,000 sellable units and 5,000 simultaneous attempts. Full successful checkout p95 is below 800 ms, admin lists below 300 ms, and there are zero oversells. Report acceptance separately from captured completion and sold-out separately from failures. Include resource consumption and queue time.

Complete the separate reservation-expiry drill: never-attempted expired reservations meet the declared less-than-ten-second release-lag target after the 15-minute TTL under the specified idle conditions. Unknown provider effects require their own reconciliation evidence.

**Learning:** experimental performance engineering, capacity and measurement definitions.

## A-08: independent release review

**Priority:** P1. **Status:** open. **Proposed owner:** reviewer who did not author the implementation.

Review the final revision, permissions, input/secret handling, integration egress, migrations, target container execution, backup/restore evidence, logs/alerts and operational ownership. Run the full-container topology on the intended environment; Compose syntax validation alone is insufficient.

**Acceptance:** findings are tracked to fixes or explicit accepted risk; no P0 gate is silently waived; runbooks are exercised; remaining dependencies and operating responsibilities have owners. Human review must be independently obtained, not inferred from self-review or agent output.

**Learning:** release judgment, incident readiness and technical defense.

## A-09: replace product hypotheses with observations

**Priority:** P2. **Status:** not started. **Proposed owner:** SWE/product partner.

Use the discovery questions in [Phase 2 stories](../docs/PHASE_2_STORIES.md). Observe actual transfer, receiving, count and return tasks; record baseline time, errors, vocabulary and exception ownership. Revisit return-window origin, promotion-usage policy and disposition expectations with users.

**Acceptance:** evidence is labeled observation versus hypothesis; story changes trace to findings; at least one measure has an actual baseline and a defined follow-up method. An interview plan is not an interview and a target is not an achieved improvement.

## A-10: independent learning capstone

**Priority:** P2. **Status:** optional planned learning slice. **Proposed owner:** learner, with independent reviewer.

Deliver the read-only transfer-aging report specified in [S8](SWE_ROADMAP.md). Keep its permission boundary and non-goals narrow. Record planned/actual SOLO time and assistance.

**Acceptance:** reviewed story, vertical slice, meaningful tests, query evidence, usable UI and technical defense. No stock/payment mutation is introduced by the report. This capstone is not implemented in the current handoff.

## Working commands

Run from the repository root. Use an isolated synthetic database for destructive experiments or workload fixtures. Run the UI functional checks without competing load when establishing a functional baseline.

```powershell
npm.cmd test
dotnet test tests/Fulfil.Tests/Fulfil.Tests.csproj -c Release
npm.cmd run typecheck
npm.cmd run build
npm.cmd run test:e2e
node scripts/integration.mjs
```

To reproduce the smaller unresolved gate:

```powershell
$env:RUN_CONTENTION = '1'
try {
    node scripts/integration.mjs
    $taskContentionExit = $LASTEXITCODE
    Write-Output "Contention exit code: $taskContentionExit"
}
finally {
    Remove-Item Env:RUN_CONTENTION -ErrorAction SilentlyContinue
}
```

The command is expected to be evaluated honestly against current conditions; this guide does not promise it passes. Save the report and exact source/environment identity. Stop a repeated failing experiment when it yields no new evidence; change the hypothesis or instrumentation before spending another run.

## Definition of a finished ticket

The intended behavior is concrete, the change is reviewable, relevant tests and failure cases have evidence, source/docs agree, and remaining risks are stated. A learning ticket additionally requires your prediction, assistance record, explain-back and appropriate review. Update the current state rather than leaving stale success claims or abandoned active work.
