# Stockade Upskilling: Reading and Practice Path

Your central question: how can several people act on the same finite inventory without losing intent, overselling, or concealing an inconsistent transition?

The course has four layers. [READ-ME-FIRST.txt](READ-ME-FIRST.txt) is the factual retrospective. [USER-STORY-WALKTHROUGHS.md](USER-STORY-WALKTHROUGHS.md) supplies fictional customer requests and scripted review exchanges. [ARCHITECTURE-CLINIC.md](ARCHITECTURE-CLINIC.md) connects those stories to code and alternatives. [PRACTICE-WORKBOOK.md](PRACTICE-WORKBOOK.md) turns the ideas into predictions, code reading, existing test runs and proposed extension designs.

Suggested sequence, spread across sessions at your own pace:

1. Model the business before the API. Read stories 1 and 4, then clinic sections 1-3. Complete workbook lab 1. Explain the difference between physical, reserved and available stock without looking at the guide. Trace each legal order transition.
2. Preserve intent through failure. Read story 2 and clinic sections 4-6. Complete labs 2-3. Explain why a fresh key is a new purchase attempt, and why a 409 must preserve the form.
3. Require shared-storage evidence. Read stories 3 and 6. Complete labs 4-5. Inspect rollback and contention tests, including every rejected outcome. Separate correctness measurements from claims about production throughput.
4. Review the browser as a concurrent system. Read story 5 and complete lab 6. Sketch two tabs with one shared cookie, then a single tab with two out-of-order responses. Identify the different mechanisms needed for those different races.
5. Change a boundary deliberately. Read stories 7-8 and clinic sections 7-8. Write a one-page design for the partial-refund capstone before asking an agent to implement anything. Use the workbook's Builder/Challenger/Verifier prompts and resolution note.

Concrete outputs to keep in your own learning journal:

- One inventory transition table with worked quantities.
- One request/commit/lost-response timeline.
- One stale-version recovery sketch.
- One independent test critique: what it proves and what it cannot prove.
- One proposed migration and rollback boundary for an extension.

How to read the labels:

- "Implemented" refers to the current local edition, not full production scope.
- "Fictional" refers to people, stories or scripted review conversations.
- "Proposed extension" means a design exercise; no feature completion is implied.
- "Observed" belongs to the actual evidence in [VERIFICATION.md](VERIFICATION.md) and reviews/.

You can start with the running app at http://127.0.0.1:4318. Manual changes persist in its demo database. Existing test suites create isolated fixtures; code experiments should use a separate copy/branch and disposable databases.

Source paths in the text are relative to stockade-rebuild/. The README links the guides directly. No new runtime behavior or test result is implied by this documentation expansion; the original verification evidence is preserved.

Added with the 2026-10-01 upskilling expansion: [PRACTICE-WORKBOOK.md](PRACTICE-WORKBOOK.md) labs 7-9 (diagnosing the recorded flaky run, the expiry-versus-payment race with its later-added deterministic test, and a real v1-to-v2 schema migration), an implementation tier for the partial-refund capstone, and [diffs/review-fixes.md](diffs/review-fixes.md), which reconstructs the session-aging and stale-tab-logout fixes as study-able diffs. Work them after lab 6.

After Stockade, study Relay's effect/checkpoint crash story. Stockade's simulated payment and inventory share one transaction; Relay shows what changes when an accepted effect lives beyond that transaction. This comparison is the bridge from a correct local command to a recoverable integration. The course overview across all three rebuilds is in [CURRICULUM.md](../../CURRICULUM.md) at the repository root.
