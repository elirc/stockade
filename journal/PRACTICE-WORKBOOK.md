# Stockade Practice Workbook

These are learning exercises, not a record of additional implemented features or tests already run. Existing automated suites use isolated databases. Manual actions in the running app persist in its demo data. For code experiments, use a separate copy or your own version-control branch and disposable databases; do not point fault experiments at the app's saved data.

For each lab, write your predicted result before reading its answer. Your deliverable is a short design note plus evidence, not just a passing command. Suggested durations are flexible estimates for a learner.

## Lab 1: Account for every unit (30-45 minutes)

Start a paper ledger with onHand=7 and reserved=0. Order A reserves three. Order B reserves two. A pays. B cancels. A ships. A receives a full restocking refund. Fill in physical, reserved and available after every action.

Then repeat with a non-restocking refund. Explain which number differs and why a refund need not mean a physical item returned to a shelf.

Read the order action handler in [src/app.js](../src/app.js). Identify the status precondition, stock mutation, ledger entry and event for each command. Does any branch change reserved when payment succeeds? It should retain the existing hold.

**Answer guide:**

```
Initial:                (7,0,7)
A reserves three:       (7,3,4)
B reserves two:         (7,5,2)
A pays:                 (7,5,2)
B cancels:              (7,3,4)
A ships:                (4,0,4)
A refund + restock:     (7,0,7)
A refund, no restock:   (4,0,4) instead of the previous row
```

Explain why decrementing physical stock at checkout would require a different vocabulary and restoration policy. The point is consistency between the model, API and interface, not memorizing one universal inventory schema.

## Lab 2: Distinguish retry from a new purchase (45-60 minutes)

Read the normalized-intent test in [tests/core.test.js](../tests/core.test.js) and the lost-response scenario in [tests/browser.mjs](../tests/browser.mjs). Draw two histories: response lost before commit, and response lost after commit. From the user's error alone, which occurred?

For the same business and key K, predict these requests:

- A. Product 1 quantity 1, then identical items again.
- B. Product 1 quantity 1, then quantity 2.
- C. Two different products, then the same pairs in reversed order.
- D. Cancel the created order, then repeat its original checkout request.
- E. Same cart under a newly generated key.

**Answer guide:** A returns one identity; B conflicts; C normalizes to the same intent; D returns the cancelled order rather than reserving again; E represents a new attempted purchase and may succeed if stock is available. A new key is not inherently a harmless retry.

Extension exercise: propose a recovery flow when browser storage is lost. Write down what the account can search, which data is safe to expose, and how the user distinguishes a previous order from a similar new purchase. Do not silently merge orders merely because their item lists happen to match.

## Lab 3: Make a conflict useful (45 minutes)

Inspect the stock adjustment browser test. It opens a form, performs another stock change, submits the stale form, confirms rejection, and explicitly resubmits after current data is shown.

Sketch an improved conflict panel on paper. Include old observed quantities, current quantities, the user's proposed delta, the projected result, and a clear action to confirm or abandon. This is a proposed UI exercise, not a description of every field in the current panel.

**Answer guide:** a 409 must not erase the delta or reason. Automatically applying the old delta to the latest version bypasses the user's review. If the user intended an absolute shelf count rather than a relative change, show that distinction explicitly; "set to 12" and "add 2" can diverge after concurrent activity. Version checks expose that ambiguity instead of deciding silently.

## Lab 4: Prove rollback, not just an error status (60 minutes)

Open [tests/adversarial.test.js](../tests/adversarial.test.js) and find the forced activity failure. List every table that the command could have changed. Predict the before/after relationship if the audit insertion fails after earlier writes were attempted.

Run the existing isolated suite from the project directory:

```
node --test tests/adversarial.test.js
```

This creates its own test fixtures. Do not install its fault trigger into data/stockade.sqlite. The exercise is to read its evidence and explain the transaction boundary, not to damage the saved demo.

**Answer guide:** an error response alone does not prove rollback. Read products, orders or order state, and relevant ledger/activity records. The transaction must leave business state consistent with the command not having committed. A separate log written after success would not have this all-or-nothing rule.

## Lab 5: Read a contention test like a reviewer (60-90 minutes)

Read [tests/contention.test.js](../tests/contention.test.js) before running it. Find how it starts two actual servers, gives them one database, creates stock, assigns distinct request keys, collects responses and shuts down children. Explain why 500 promises against one mocked handler would establish a different level of evidence.

Run the existing disposable experiment:

```
node --test tests/contention.test.js
```

Record accepted, conflict and unexpected response counts, final quantities, and elapsed time. Keep the machine/context next to the measurement. Do not turn one local run into a requests-per-second production capacity guarantee.

**Answer guide:** 100 accepted plus 400 stock conflicts is the expected distribution. The absence of negative stock alone is insufficient. A system accepting zero requests can satisfy that weak check. Also inspect same-key concurrency and restart replay; those test intent identity, not merely stock conservation.

## Lab 6: Review a two-tab identity bug (45-60 minutes)

Trace session resolution, X-Stockade-Account comparison and DELETE /api/session in [src/app.js](../src/app.js). Explain why moving one route above middleware changes behavior even if every helper function remains unchanged.

Read the last two scenarios in [tests/ui-races.mjs](../tests/ui-races.mjs). The stale tab first attempts a write under an account changed elsewhere; it later attempts logout. Write the expected HTTP result, identity shown after reconciliation, and session that must remain valid.

**Answer guide:** the stale expectation conflicts rather than authorizing a write or revoking the newer session. Server authority comes from the cookie; the header expresses the identity the interface expected. Treating that header as permission would introduce a different and much worse bug.

One combined build run had an unexplained held-login timeout; later diagnostic and full runs passed. [VERIFICATION.md](VERIFICATION.md) preserves that uncertainty. If you see it again, retain the network sequence and pending request/body information. Do not weaken the assertion or merely raise timeouts before investigating.

## Lab 7: Diagnose a real flaky test (60-90 minutes)

[VERIFICATION.md](VERIFICATION.md) records a genuinely unresolved event: one final combined browser run timed out waiting for the catalog after releasing a held login response. No browser runtime error appeared, a traced diagnostic run passed, the next full run passed, no application change was made, and the cause remains unconfirmed. This is not a tidy exercise — it is a real flake with retained evidence, which is rarer and more valuable than any synthetic one.

Read the "Test reliability note" in [VERIFICATION.md](VERIFICATION.md), then the held-login scenario in [tests/ui-races.mjs](../tests/ui-races.mjs), then the network events retained in [evidence/ui-race-results.json](evidence/ui-race-results.json).

Work like an engineer on call, not a storyteller:

1. Write down every hypothesis that fits all the evidence (including "the harness, not the app"), and for each, what trace or log line would confirm or kill it.
2. Classify each hypothesis: application defect, test-harness race, environment (machine load, browser startup), or observation gap.
3. Design the cheapest instrumentation that would decide between your top two next time it fires — without changing product behavior.
4. Decide what you would do today: quarantine the scenario, add the instrumentation, rerun N times, or leave it. Defend the choice in three sentences.

**Answer guide:** there is no confirmed answer, and writing one down anyway would be the real failure. A passing rerun is weak evidence of absence; it bounds frequency, nothing more. The defensible engineering positions are (a) retained-evidence instrumentation plus a rerun budget, or (b) explicit quarantine with an owner and a trigger for revisiting. Inventing a fix and declaring victory — the move this project's verification explicitly refused — converts an honest unknown into a false record. Compare your hypothesis list with the note's own observation: Astra's read-only review found no deterministic cyclic await, which constrains but does not close the application-defect branch.

## Lab 8: Race expiry against payment (60 minutes)

The retrospective's closing challenge: predict the result of expiry and payment arriving at nearly the same time. A reservation holds stock; expiry releases it; payment keeps it. Both transitions are legal from `reserved` — so exactly one must win, the loser must see a coherent conflict rather than a 500, and the released hold must be released exactly once.

Write your prediction first: for each interleaving (payment commits first; expiry commits first; both in flight), state the final order status, `onHand`, `reserved`, and what the paying client is told.

Then read [tests/expiry-race.test.js](../tests/expiry-race.test.js) — added after the original verified build as part of the upskilling expansion — and check your prediction against its assertions. Note how it makes the race deterministic instead of sleeping through real TTLs, and that the paid-then-sweep direction is asserted too: a sweep must never expire a paid order.

**Answer guide:** the invariant `onHand >= reserved >= 0` must hold in every interleaving, and the double-release is the subtle failure — expiry and decline both releasing the same hold would create stock from nothing. The guard is the same shape as every other guarantee in this project: a state precondition inside the write transaction, not a check made before it. If your prediction disagreed with the test, decide which is wrong before assuming it is you.

## Lab 9: Ship a schema migration (90 minutes - 3 hours)

[ARCHITECTURE-CLINIC.md](ARCHITECTURE-CLINIC.md) section 8 argues a migration is a user story with old data — but the database has only ever had version 1, so the argument is untested here. Make it real on a branch.

Pick a small, honest schema change (a note field on refunds, a per-line restock count toward the capstone, or the multi-warehouse `location` column from story 8) and ship it as a migration: `user_version` 1 to 2, transactional, idempotent across restarts, rejecting version 3+ databases.

Done when:

- A test copies a seeded v1 database file, opens the new code against it, and proves old orders and stock survive and the new column works.
- A fresh database seeds directly at v2; running the migration twice is harmless.
- A v3 database (set `PRAGMA user_version = 3` in a fixture) is rejected with a clear error, not silently modified.
- The original suites pass: `npm run check`, `npm test`, `npm run test:browser`.
- One sentence in your journal: what would be different if a server were running against the file during the migration?

**Answer guide:** the hard part is not the ALTER TABLE — it is deciding default values for rows that predate the concept, and proving the window where neither version owns the file is empty (here, the transactional `user_version` bump; in production, a deploy orchestration question). The sibling gitjira project's EXERCISES.md has the same exercise against its schema; doing both shows how little of the work is SQL.

## Capstone: Design partial refunds (2-4 hours for a design)

Proposed extension; not present in the rebuild.

Story: an order shipped three units of product A and two of B. The customer returns one A and both B. One B is damaged and must not be restocked. Later, the customer returns another A. A duplicate request for the first return also arrives. Design this without refunding or restocking any unit twice.

Deliverables:

- Explicit distinction between financial refund and physical restock.
- A refund/return record with request identity and per-line quantities.
- Invariants bounding cumulative refunded and restocked quantities.
- A transaction narrative and retry semantics.
- A UI that shows remaining eligible quantities and preserved draft input.
- A migration story for orders already marked fully refunded.
- At least six tests, including duplicate intent, changed intent and races.

Answer direction: a single restocked boolean on the whole order no longer expresses the requirement. Per-line cumulative accounting or immutable return records are needed, with a clear source of truth. Two concurrent returns must not both read the same remaining quantity and overshoot it. Keep the guarantee in shared storage. Real money would add the provider uncertainty from story 7.

### Implementation tier (optional, add 4-8 hours)

Build the design, tests first, in the harness style of [tests/adversarial.test.js](../tests/adversarial.test.js) (real HTTP, isolated temporary databases). Put new tests in their own file so the original evidence record stays legible. Done when:

- A refund exceeding a line's remaining refundable quantity is rejected with a coherent conflict, and durable state is unchanged (inspect the tables, not just the status code).
- Replaying the same return request key returns the same return record; a changed per-line intent under that key conflicts.
- Two concurrent returns against the same remaining quantity produce exactly one success — proven with the two-process pattern from [tests/contention.test.js](../tests/contention.test.js), not `Promise.all` in one process.
- Restock respects the damaged-unit exclusion and the inventory cap; a forced audit-insert failure rolls the whole return back (trigger technique from [tests/adversarial.test.js](../tests/adversarial.test.js)).
- Orders marked fully refunded before your change still read correctly — your Lab 9 migration carries the schema.
- The original three suites pass unchanged, and `onHand >= reserved >= 0` holds in every new test's final state.

## How to use three review roles without manufacturing consensus

Builder brief: "Implement only the agreed slice. State its invariant, request contract and transaction boundary. Identify unsupported behavior explicitly."

Challenger brief: "Find one concrete history that violates the promise. Include initial data, competing actions, failure point and observable wrong result. Do not ask for infrastructure unless it solves a demonstrated problem."

Verifier brief: "Convert that history into an independent test. Inspect durable state as well as HTTP/UI output. Report exact results and limits. Do not modify the expected behavior simply to match the implementation."

Resolution note template:

```
User promise:
Counterexample:
Options and consequences:
Chosen policy and code boundary:
Test that would falsify the policy:
Observed evidence:
Remaining uncertainty:
```

Evaluate your explanation on five dimensions, 0-2 points each: precise user outcome, valid state model, explicit failure/retry behavior, appropriate proof, and honest limits. A strong answer is inspectable and falsifiable. Naming more frameworks or asking three models to agree does not improve the score by itself.
