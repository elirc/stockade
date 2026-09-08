# SWE upskilling roadmap

## Goal and starting point

Use Stockade to demonstrate that you can understand, change, validate and operate an application with inventory and financial state. The destination is independent engineering judgment supported by artifacts, not memorizing this repository or collecting passing tests.

The application was built in DELEGATE mode. Your baseline is **unassessed**. This roadmap is a proposed next learning program, not a claim that you completed the original mentorship milestones. Keep the unresolved performance and release gates visible while learning Phase 2.

## Time, assistance and progression

The plan below allocates approximately **48-68 hours**, with a midpoint of **58 hours**, before unbounded external release work. At six hours per week that is roughly eight to twelve weeks; adapt to actual evidence rather than treating the calendar as a promise.

| Stage | Focus and original milestone mapping | Estimated hours | Planned SOLO hours |
|---|---|---:|---:|
| S0 | Reproduce and map the system; M0-M1 | 2-4 | 1 |
| S1 | TypeScript, React and request contracts; M1-M2 | 4-6 | 2 |
| S2 | C#, states, SQL and concurrency; M2-M3 | 6-8 | 3 |
| S3 | Pricing, payments and compensation; M4-M5 | 6-8 | 3 |
| S4 | Fulfillment, promotions and returns; M6-M8 | 6-8 | 3 |
| S5 | Product stories, transfers, purchasing and counts; M13-M17 | 6-8 | 3 |
| S6 | APIs, security, events and recovery; M9-M10 | 6-8 | 3 |
| S7 | Performance diagnosis and release evidence; M11-M12 | 4-6 | 2 |
| S8 | Independent extension and technical defense; M18 | 8-12 | 4 |
| Total | Planned learning effort | 48-68 | 24 |

The SOLO allocation is 24/58 = approximately 41% of estimated midpoint hours, above the master prompt's 30% planning floor. It must include a ticket on your weakest demonstrated competency. Record actual time and mode changes separately; do not relabel assisted work as SOLO or alter old estimates to repair the percentage.

Plan roughly 70% ticket work and 30% drills within these same hours, not as an additional parallel curriculum. A SOLO task uses ordinary documentation and tools without AI implementation help. PAIR permits guided collaboration. DELEGATE means implementation is done for you and you must still critique it. Record assistance for SPIKE work explicitly.

After 45 minutes without meaningful progress, write the attempts, evidence and specific question before escalating. A failed prediction is useful evidence when you explain and correct it. Advance when the stage's gate is met, not just when its time estimate expires. The performance diagnosis estimate does not promise resolution of the release blocker within six hours.

## S0: reproduce and orient

**Do:** read [the summary](PROJECT_SUMMARY.md), start the local stack from the root README, run the unit suites, and complete a small simulator checkout. Identify the services, their database ownership, and the source of truth for stock.

**SOLO artifact:** draw the request and payment sequence from memory after reading the code. Label transaction boundaries and identify three places a client can lie.

**Gate:** another engineer can follow your environment note, and you can explain cart persistence versus a checkout reservation. Record versions and actual commands; do not assume today's running processes will exist in your next session.

**Deliverables:** setup note, architecture sketch, initial skill baseline and one learning log.

## S1: TypeScript, React and HTTP contracts

**Do:** trace the cart save and the command-key helper. Explain asynchronous state, effect cleanup, structured errors, session cookies, Origin checks, and why display totals are not the business authority. Review shared forms, focus behavior and loading states.

**SOLO artifact:** write a meaningful negative-origin or uncertain-response test from a written failure scenario before viewing the existing solution. If the existing test already covers your scenario, choose a distinct observable failure rather than duplicating it.

**Gate:** demonstrate a successful save, a rejected save and an uncertain command response. Explain which UI state may change in each case and why a retry must preserve identity.

**Deliverables:** request contract, focused test, browser evidence and a short review of one generic-JSON boundary that would benefit from stronger types.

## S2: C#, domain rules and database consistency

**Do:** read Rules, Models, StockadeDb, Transactions and Admission. Explain guards, transactions, checks, uniqueness, composite tenant relationships, isolation, rollback and bounded retries. Compare a row invariant with a cross-record invariant.

**SOLO artifact:** write a state-transition or quantity-race test whose failure would show a business defect. Predict all affected rows before running it.

**Gate:** explain why an in-memory lock alone cannot protect two application instances, why a stock check alone cannot prove ledger agreement, and what must roll back when a command fails.

**Deliverables:** state graph, inventory equation worksheet, negative test and one-page concurrency design comparison.

## S3: pricing, payments and compensations

**Do:** follow server pricing, quote rollback and expectedTotal validation, then trace the worker's authorize/capture/void/refund boundaries. Review the difference between decline and uncertainty.

**SOLO artifact:** implement a bounded rounding or provider-outcome test after writing the expected state timeline. Use a controllable test double for new failure modes; label it as a test harness.

**Gate:** explain one crash between external acceptance and local persistence. Demonstrate why stock or refund capacity remains committed until reconciliation and why one durable provider key matters.

**Deliverables:** payment sequence, rounding worksheet, failure experiment and provider-evidence checklist. Authentic Stripe execution remains separate from this local stage.

## S4: order evolution and customer settlement

**Do:** complete partial shipment, a return decision/receipt and separately confirmed replacement purchase. Examine promotion usage policy, original price/tax snapshots and eligible quantities.

**SOLO artifact:** choose a previously untested combination, such as changed catalog pricing after a partial return or a rejected return freeing an eligible claim. Specify the acceptance criteria before implementation.

**Gate:** reconcile the stock and money totals and explain to a customer which refund and which new charge will occur. Show that a repeated request cannot restock or refund twice.

**Deliverables:** before/after ledger, one customer-facing explanation, focused regression and evidence limitations.

## S5: extend a system through product stories

**Do:** read the original four epics and twelve stories. For each epic, identify the user, business outcome, invariant, one missing failure case, and the current code/test boundary. Run the transfer conservation and stale-count examples.

**SOLO artifact:** write a small unfamiliar variation with Given/When/Then criteria, permissions, data ownership, migration impact, non-goals, estimate and measurement plan. Do not invent merchant interviews or success metrics.

**Gate:** explain how a transfer differs from supplier inbound stock, why rejected goods remain unsellable, and why count corrections must preserve commitments. Reconcile all new commitment types.

**Deliverables:** story critique, transfer worksheet, count evidence and a proposed feature slice ready for review.

## S6: integrations, security and operations

**Do:** trace a revoked key, a wrong-tenant record, an invalid signature and an outbox retry. Read the operational runbook and identify what a database/key-ring restore would require.

**SOLO artifact:** add a scope/replay/recovery check that proves persisted effects, or write a restore rehearsal plan on an isolated database. Select a task that addresses your weakest demonstrated area.

**Gate:** distinguish authentication, authorization, idempotency and replay protection. Explain why at-least-once delivery can repeat and what the receiver must persist.

**Deliverables:** permission matrix, event timeline, security evidence and recovery checklist. A self-review is not independent security approval.

## S7: diagnose performance and assess release readiness

**Do:** execute the bounded investigation in [A-01](NEXT_STEPS.md). Capture environment, queue time, transaction/query cost, retries, worker effects, outcome distribution and an identified bottleneck. Use smaller runs diagnostically before the unchanged acceptance workload.

**SOLO artifact:** write the hypothesis and experiment before reading a suggested optimization. Defend which measurement would falsify your hypothesis.

**Gate:** produce a reproducible profile with honest pass/fail status. If the 500/100 gate still fails, keep it open and specify the next discriminating experiment. Completing this learning stage does not close the production release gate.

**Deliverables:** performance report, comparison of alternatives, small justified change if supported, and updated release decision.

## S8: independent capstone and defense

Proposed capstone: **a read-only transfer-aging report** for owners/administrators. This is future learning work, not a feature claimed in the current build. Resolve the P0 correctness/performance investigation before treating the capstone as release expansion; design work can proceed during learning.

**User story:** As an inventory manager, I want outstanding transfers grouped by age and responsible owner so that I can follow up before goods remain unresolved.

Initial acceptance criteria:

1. Given a same-merchant outstanding transfer older than a validated threshold, it appears with source/destination, outstanding units, age, owner and next action.
2. Resolved/cancelled records do not appear as outstanding. Define the treatment of every transfer state before coding.
3. Stable pagination and validated filters produce repeatable results; duplicate timestamps do not duplicate or skip records between stable pages.
4. Unauthorized and foreign-merchant access fails without revealing records.
5. The report has loading, error, empty and keyboard-operable states.
6. Reading the report changes no inventory, workflow, audit history or payment state.
7. Query and UI tests cover boundaries; explain the index/query tradeoff with actual evidence.

Start with owner/administrator browser access. Additional key scopes, warehouse-operator access, exports, alerts and automatic actions are explicit non-goals unless separately designed. Keep an API contract and permission decision with the story.

**SOLO artifact:** own a bounded vertical slice without AI implementation help, keep the assistance record, and submit the final revision for review by someone who did not author it.

**Gate:** demonstrate the feature, defend a rejected design, solve an unfamiliar review question and show that existing stock/financial invariants remain protected.

**Deliverables:** story, implementation diff, migration decision, tests, demo, review response and an updated learning assessment.

## Assess yourself from artifacts

| Score | Observable behavior |
|---|---|
| 0 | Cannot reproduce or explain the behavior yet |
| 1 | Completes the task with substantial guidance; explanation has unresolved gaps |
| 2 | Independently handles a familiar case, tests a real failure and explains the relevant invariants |
| 3 | Handles an unfamiliar variation, diagnoses a misleading failure, and defends tradeoffs with evidence and review |

Assess TypeScript/UI, C#/domain modeling, SQL/concurrency, distributed recovery, testing, security, performance, product scoping and technical communication separately. Do not average away a critical weakness in inventory or financial correctness. Current scores are blank/unassessed.

## Portfolio and interview evidence

Keep a compact set of defensible artifacts: system diagram, one invariant proof, a bug postmortem, a meaningful test, a performance investigation, a reviewed feature diff, and a five-minute explanation of a failure/recovery path. State which code was delegated and which slice you authored independently.

A credible summary is: what broke, what you predicted, what the data showed, what you changed, how you verified it, and what remains unknown. Do not claim production traffic, measured merchant improvements, independent ownership of delegated code, or full load acceptance without the corresponding evidence.
