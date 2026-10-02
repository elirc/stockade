# Worked example: the oversell experiment

Lab 5 ends with a reviewer's question: with two Node processes sharing one SQLite file, what exactly stops both of them from taking the last unit? This document performs that question for real, once, as a model of the predict -> break -> observe -> revert loop. It is a disposable experiment against the isolated test suites, never against data/stockade.sqlite (workbook ground rules apply). Do your own run before reading past "Predict first" — the point of the loop is that your prediction gets graded.

Baseline, captured before touching anything (`npm test`, twice):

```
# Stockade two-process contention: 500 requests in 2954ms; outcomes {"201":100,"409":400}
# tests 16
# pass 16
# fail 0
```

## Predict first

The contention test creates one product with 100 on hand, then fires 500 unique-key checkouts split across two server processes. Healthy distribution: 100 accepted (201), 400 stock conflicts (409), final stock (onHand, reserved, available) = (100, 100, 0).

The checkout transaction in [src/app.js](../../src/app.js) guards stock twice: a read-and-check (`product.available < item.quantity` -> 409 SOLD_OUT) and an availability recheck in the reserving UPDATE's WHERE clause (`AND on_hand-reserved>=?`). Beneath both sits the schema CHECK in [src/database.js](../../src/database.js): `reserved>=0 AND reserved<=on_hand`.

Before reading on, write down: if the WHERE-clause condition is deleted, does the contention test oversell (reserved > 100)? Return 500s from the CHECK constraint? Or something else? Which layer do you believe owns the guarantee?

Spoiler break below — commit to a prediction first.

---

## The plausible-looking break

The edit mimics a review comment you will actually see: "we already check availability a few lines up, inside the same transaction — the WHERE condition is redundant, simplify it."

```diff
-            "UPDATE products SET reserved=reserved+?,version=version+1 WHERE id=? AND tenant_id=? AND on_hand-reserved>=?",
+            "UPDATE products SET reserved=reserved+?,version=version+1 WHERE id=? AND tenant_id=?",
           )
-          .run(line.quantity, line.productId, req.tenant, line.quantity);
+          .run(line.quantity, line.productId, req.tenant);
```

The earlier read-and-check stays, so a single process poking the API by hand looks completely fine. That plausibility is the trap the lab teaches you to review for.

## What actually happened

Run `npm test` twice with the break in place. Both runs, stage 1:

```
# Stockade two-process contention: 500 requests in 2740ms; outcomes {"201":100,"409":400}
# tests 16
# pass 16
# fail 0
```

Nothing failed. No oversell, no 500s, same distribution, twice. The "redundant" comment was — in this exact architecture — *true*: the transaction helper runs `BEGIN IMMEDIATE`, which takes the write lock before the callback's first read. So the read-and-check is not an advisory peek; it already executes under the same lock that serializes the two processes' writers. The second process blocks on `busy_timeout`, then reads post-commit truth and 409s in JavaScript.

That green result is itself the finding, and it sharpens the question: if the JS check is doing the work, what happens when *it* is the thing a refactor loses? Stage 2 of the experiment removes the read-and-check too (delete the `fail(409, "SOLD_OUT", ...)` block in the checkout line mapper), leaving the schema CHECK as the only guard. Both runs:

```
# Stockade two-process contention: 500 requests in 3421ms; outcomes {"201":100,"500":400}
not ok 1 - multi-line checkout is atomic, priced by server, and durable key replays one order
not ok 8 - 500 checkouts against 100 units across two independent Node processes conserve stock
# tests 16
# pass 14
# fail 2
```

(Second run: 3773ms, identical outcomes `{"201":100,"500":400}`, identical two failures. Deterministic — the CHECK fires on every attempt past unit 100, regardless of interleaving.)

Still no oversell: reserved never exceeded 100, because the 401st reservation violates `reserved<=on_hand`, the statement throws, and the transaction helper rolls the whole order back. But the API now answers with:

```
{"error":"The operation could not be committed. No partial changes were saved.","code":"INTERNAL"}
500 !== 409
```

That assertion is from `tests/adversarial.test.js:98` — a deliberate two-line sold-out checkout that expects a useful 409 SOLD_OUT and gets a generic 500. The contention test fails the same way at scale: `{"201":100,"500":400}` instead of `{"201":100,"409":400}`.

## Which layer actually owns the guarantee

- **Application read-and-check.** Advisory *in general* — a read-then-decide outside the write lock can go stale. Here it runs inside `BEGIN IMMEDIATE`, so it is genuinely protective (stage 1 stayed green) — but only for as long as nobody weakens the transaction helper to a deferred `BEGIN` or moves the check outside `transaction()`. Its real job is the *good error*: a specific 409 with the product's current numbers.
- **The UPDATE's WHERE under BEGIN IMMEDIATE.** The guard the invariant comment points at. It restates the business rule at the exact statement that mutates stock, so it holds even if the surrounding check moves or the lock discipline changes. Stage 1 shows removing it is invisible *today*; stage 2 shows what the codebase feels like once conditional guards erode.
- **The schema CHECK.** Last line of defense, and it worked: zero oversold units in 1000 attempted reservations across both stage-2 runs. But it defends the *data*, not the *contract* — customers get 500 INTERNAL instead of 409 SOLD_OUT. Clinic section 2 applies: each layer excludes a different counterexample; "no negative outcome reached disk" is a much weaker promise than "the API behaved."

The oversell never happened at any stage. What degraded, layer by layer, was the quality of the refusal.

## Restore and confirm

```
git checkout -- src/app.js
npm test
git status --short
```

Captured after reverting:

```
# Stockade two-process contention: 500 requests in 4404ms; outcomes {"201":100,"409":400}
# tests 16
# pass 16
# fail 0
```

`git status --short` showed nothing under src/. Never leave the break in, and never commit a run with it present.

## Doing this yourself

1. Confirm a clean tree: `git status --short` must show nothing under src/.
2. Baseline: `npm test`. Record the pass count and the contention line.
3. Write your prediction down before editing anything.
4. Make one small, plausible edit to the checkout transaction in src/app.js. Note exactly what you changed.
5. `npm test` twice. Record failing tests, the outcome distribution, and whether the two runs agree.
6. Revert with `git checkout -- src/app.js`, rerun `npm test`, confirm 16/16 and a clean `git status --short`.

Timings above are from one machine on one day (Windows 11, Node 22); keep your own context next to your own numbers, and do not promote any of this into a throughput claim.
