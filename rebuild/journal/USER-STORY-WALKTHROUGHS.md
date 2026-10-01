# Stockade: From a Customer Request to a Correct System

These people, conversations, and sprint sequences are fictional teaching scenarios. Stories 1-6 explain behavior present in this local rebuild, using the delivered source as the reference. Stories 7-8 propose extensions that have NOT been implemented. Proposed acceptance tests are not new test results; the actual evidence remains in [VERIFICATION.md](VERIFICATION.md).

Read each story twice. First follow the customer problem. Then trace the implementation from browser action to API to transaction to persisted state. The Builder / Challenger / Verifier passages are scripted review roles, not quotes from Astra or Sol or a transcript of their private reasoning.

## Story 1: Nora wants to sell the last two totes

Status: implemented core behavior; fictional customer and delivery sequence.

Nora runs a small shop. She has two totes left. Three people reach checkout at nearly the same time. Her request is simple: "Do not promise a tote we cannot ship, but let a buyer finish paying after checkout."

The first implementation question is what the word "sell" means. Does a cart hold inventory? Does checkout hold it? Does payment remove it? Without that agreement, a programmer can produce internally consistent code that solves the wrong business problem.

For this edition, adding to a browser cart does not hold stock. Checkout makes a temporary reservation. Approved simulated payment retains the reservation. Shipment removes physical stock. That gives us three quantities to explain: physical onHand, held reserved, and computed available = onHand - reserved.

Acceptance criteria would be written before the page:

- At most two one-unit checkouts succeed while those holds remain active.
- The third request receives a conflict, with no partial order or hold.
- Paying for a reserved tote does not make it available to another buyer.
- Shipping one paid tote reduces physical and reserved stock by one.

Walk through the numbers:

```
Start:                  onHand=2, reserved=0, available=2
First checkout:         onHand=2, reserved=1, available=1
Second checkout:        onHand=2, reserved=2, available=0
First payment:          onHand=2, reserved=2, available=0
First shipment:         onHand=1, reserved=1, available=0
```

The first vertical slice would contain a seeded product, POST /api/checkouts, a stored order and line item, and a test that reads the resulting quantities. Only after that works would we add the cart and the order dialog. This makes the database behavior observable before CSS or browser state can obscure it.

The data design lives in [src/database.js](../src/database.js). Product constraints enforce on_hand >= reserved >= 0. The checkout handler in [src/app.js](../src/app.js) opens a BEGIN IMMEDIATE transaction, reads current stock, snapshots server prices, creates the order, conditionally increases reserved, and writes the ledger and activity records. An exception rolls the entire transaction back.

The conditional UPDATE requires sufficient available stock. The transaction also serializes competing writers across processes. These protections have different jobs: a process-local button lock handles accidental UI repetition; shared storage handles competing clients and server processes.

Builder: "I can disable checkout after the first click."

Challenger: "Two browsers still have two enabled buttons. Which shared fact prevents both from acquiring the final unit?"

Verifier: "I will run separate server processes against one database and count every accepted and rejected request, then inspect the stored totals."

The delivered contention test scales this story to 500 requests for 100 units. It checks the complete outcome distribution. A test that only checks for a negative number could pass even if the application incorrectly rejects every buyer. Correctness includes admitting valid work as well as rejecting excess.

Pause and predict: if the first order is paid but not shipped, should its hold expire? Here the answer is no. The expiry policy applies to unpaid reserved orders; freeing paid inventory would break Nora's promise to that buyer.

## Story 2: Leo checks out, but the response disappears

Status: implemented, including browser recovery after a reload.

Leo clicks Reserve order. The server commits the reservation. His browser receives an error instead of the successful response. He says, "I just need to try again without buying it twice."

The tempting fix is a Retry button that sends a fresh request. That confuses two different intentions: retrying the same attempted purchase and placing a second purchase. The system needs a durable identifier for the first intent.

We would add a client-generated idempotencyKey to the checkout contract. The browser creates it before submitting and saves it with the cart. The server stores it with a fingerprint of normalized product/quantity pairs. The uniqueness boundary is business plus key, because businesses are isolated.

Sorting the pairs means swapping their display order does not invent a new purchase. Duplicate product IDs are rejected rather than ambiguously summed. The fingerprint excludes client totals: the server owns prices. On replay, the existing order is returned before new allocation is attempted. This is essential when that order already reserved the last unit.

The implementation path would be:

1. Validate and normalize the cart.
2. Within the stock transaction, look for the business/key pair.
3. If found, compare intent and return the existing order or a conflict.
4. Otherwise allocate stock and store the key with the new order.
5. Have the UI retain the key when the outcome is uncertain.

The transaction closes a dangerous gap. If allocation committed first and the key were saved later, a crash between them would leave an order that the retry cannot recognize. The retry could then create a second reservation.

There is also a product choice: what should a replay return after the order is cancelled? This app returns the same identity in its current state. Leo sees the cancellation. The old key cannot create another hold. A new purchase requires a new key. Byte-identical replay would be another possible contract, but showing a frozen "reserved" response after cancellation would need careful presentation so it did not mislead the operator.

Builder: "The key is stored, so recovery is complete."

Challenger: "What if Leo changes quantity after the error? Does the browser throw away the only key that can find the possibly committed order?"

Verifier: "I will commit the server request, replace the response with a 503, check that the cart cannot change, reload, and recover the same order."

The delivered UI uses that recovery policy. An uncertain cart stays fixed until recovery. [src/app.js](../src/app.js) owns durable identity; [public/app.js](../public/app.js) owns keeping the user's original intention available through the uncertainty.

An important limitation: browser storage can be unavailable. This app warns the user to keep the tab open. A production checkout may also need an account order lookup or support recovery path when both the browser key and response are lost. Idempotency is a recovery mechanism, not a complete support product.

## Story 3: Maya counts a damaged unit while a buyer checks out

Status: implemented relative adjustment and stale-version behavior.

Maya opens an inventory form showing ten physical units and zero reserved. She finds one damaged unit and prepares an adjustment of minus one. While the form is open, a buyer reserves two units.

A blind "save stock=9" can conceal concurrent activity. Even though nine physical units may still be valid, the operator should review the updated reservation context before committing. This edition makes every relevant stock change increment a product version, including reservation changes.

Maya's request contains {version, delta:-1, reason:"Damaged packaging"}. PATCH /api/products/:id/stock loads the product for her business inside a transaction. If the version differs, it returns a 409 with current data. The browser retains her delta and reason. A second explicit submission uses the updated version after she has reviewed the current quantities.

This is optimistic concurrency: read without holding a long user-duration lock, but require the write to prove which revision it was based on. Holding a database transaction while Maya walks to a shelf would be a very expensive way to protect a form.

Now change the numbers: physical stock is three, reserved is three, and Maya finds one missing. Reducing physical stock to two violates the current model. The app rejects it. That rejection exposes a business limitation: actual loss can make prior commitments impossible, even when the software conserved its numbers perfectly. A future shortage workflow must identify affected orders and a resolution policy. Silently allowing negative availability would hide the operational problem without deciding who gets the remaining items.

Builder: "The version check prevented the overwrite."

Challenger: "Did the error handler erase the reason Maya just typed?"

Verifier: "I will change stock after the form opens, submit the old version, and inspect both the database and the still-visible form fields."

Read the adjustment route and the corresponding browser scenario together. The route guarantees conflict detection; the UI guarantees a usable recovery experience. Either can be correct while the other fails.

## Story 4: A refund arrives twice

Status: implemented full simulated refund after shipment.

An operator refunds a shipped tote and restocks it. A slow response makes them click again. The request is "Give the customer their refund, but do not create another physical tote just because I repeated the action."

This story is about a state transition, not just a button handler. The order has already moved from reserved to paid to shipped. A valid refund changes shipped to refunded; the optional restock adds physical stock once. A repeated request must recognize the terminal result or reject incompatible intent.

We would first draw the legal transitions, then make the handler read status and restock intent within the same transaction as inventory changes. The order, stock, ledger, and activity need one outcome. If inserting the activity record fails, stock must not remain incremented while the order stays shipped.

This app also enforces an upper inventory bound. A restocking refund that would cross that bound fails as a whole. That may seem artificial at a billion units, but the test establishes an important pattern: validation or a storage constraint late in a command must not leave earlier writes committed.

Builder: "I can set status='refunded' and add the quantity."

Challenger: "What predicate limits that addition to the first successful transition? What if the second request changes the restock choice?"

Verifier: "I will repeat the action, vary its intent, force an audit failure, and read the final stock and status rather than trusting the response alone."

Do not generalize this into a guarantee about real money. Here a refund is a local simulation. A remote refund could succeed while this database remains unmodified; story 7 introduces that separate uncertainty.

## Story 5: Jamie has two business tabs open

Status: implemented account-intent protection; based on an actual bug class.

Jamie opens Northstar in tab A and switches to Daybreak in tab B. Cookies are shared, so tab A may still display Northstar while its next request carries Daybreak's session. "Don't let my old tab edit the wrong shop" sounds like a permissions requirement, but permission alone cannot describe the problem.

The server may correctly authorize Daybreak while the human believes they are acting on Northstar. The browser therefore sends the account it displays in X-Stockade-Account. The server derives authority from the session, then compares the optional displayed-account precondition. A mismatch yields a conflict and prompts identity reconciliation; the header does not authorize access by itself.

The implementation would place this check after session resolution and before affected routes. Middleware order becomes part of the behavior. Checking only product writes would miss logout: a stale tab could revoke the newly selected business session. That omission was actually reproduced during the build and fixed by moving DELETE /api/session behind the account precondition.

Separately, [public/app.js](../public/app.js) uses request/account generations to discard old responses after a switch. This handles late results within a page. The shared cookie scenario crosses pages and requires a server-visible expectation too.

Builder: "Every query is tenant-scoped."

Challenger: "Scoped to which tenant: the one in the current cookie or the one the person sees on screen? Explain how a mismatch is detected."

Verifier: "I will change the session in one tab, submit from the other, and assert no wrong-business write and no revocation of the new session."

## Story 6: Priya asks why three units disappeared

Status: stored ledger and activity exist; a full reconciliation screen does not.

Priya's stock total has changed, but she cannot remember which order caused it. A number by itself cannot answer her question. We would model each stock mutation as a command with a reason and record its physical and reserved deltas alongside that command's transaction.

The inventory_ledger table stores both delta kinds, product, tenant, optional order, action and time. Activity gives the operator a human-readable account. Those serve different readers: structured deltas support arithmetic analysis; activity explains what happened in the interface.

This does not automatically make the system event-sourced. The current product row remains operational state; the ledger is an accompanying record. Before claiming that it can rebuild the entire database, one would need to verify coverage, opening balances, ordering, correction semantics, and historical schema interpretation. A useful log and a complete replay model are different deliverables.

Builder: "I will log after returning success so checkout is faster."

Challenger: "Then a crash can acknowledge stock movement without its record."

Verifier: "I will make the activity insert fail and confirm the business mutation rolls back. Later, a reconciliation feature needs separate tests."

## Story 7: Nora wants real card payments

Status: proposed extension only; no payment integration exists.

The new request changes the architecture. A database transaction cannot make an HTTP payment provider and SQLite commit atomically. We would begin with an explicit payment-attempt record containing order, amount, currency, provider key, request identity, and an observable status such as pending or uncertain. Those names are a proposed model, not existing Stockade columns.

A hypothetical delivery sequence:

1. Define whether reservation time covers authorization, capture, or both.
2. Persist the payment attempt and stable provider key before contacting it.
3. Call a sandbox adapter outside the inventory transaction.
4. Persist the verified result with guarded order transitions.
5. Reconcile timeouts using provider lookup and authenticated events.
6. Add an operator view for outcomes that cannot yet be resolved.

The difficult question is a charge confirmed after the reservation expires. One proposed policy is to refund when stock cannot be reacquired; another is an extended payment-processing hold. Either has a customer experience and inventory cost. The story is incomplete until that choice is made explicitly.

An outbox could make the intent to contact the provider durable with the local command. It would not erase the crash window after provider acceptance. The provider still needs idempotency or a reconciliation mechanism. Relay is the companion exercise for exactly this boundary.

Acceptance work would include duplicate events, changed amounts, timeout after acceptance, worker restart, late success after expiry, and refund uncertainty. Start with a local fault-injecting adapter before a real sandbox. No provider-specific SDK or API behavior is assumed by this exercise.

## Story 8: The shop opens a second warehouse

Status: proposed extension only; current stock is per product/business.

"Show stock by warehouse" sounds like a new column. The harder request is deciding which warehouse owes which order. A proposed design separates the catalog product from stock_positions(product, warehouse), then introduces order allocations that identify the quantities held at each position.

Walk through a cart needing three units when west has two and east has two. Can we split the shipment? Does delivery promise prefer one location? Can an operator transfer stock that is already reserved? These questions determine the transaction and UI, not just the schema.

A migration plan would create one default warehouse per existing business, copy physical/reserved quantities, map active order holds, and reconcile the new totals before switching reads. A rollback plan must account for any new split allocation that the old schema cannot express. Simply dropping the new tables would lose information after new behavior begins.

Builder: "I will sum all locations and reuse checkout."

Challenger: "A positive global sum does not identify a shippable allocation."

Verifier: "I will race a transfer, checkout and shipment, and verify both per-location conservation and the business-wide total."

Your design deliverable is a worked allocation example, transition rules, migration checkpoints, and a failure matrix. Implementing a map widget before those exist would polish the least difficult part of the request.
