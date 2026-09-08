# Phase 2: product brief and user stories
## Discovery and roadmap
Provisional user: a small multi-warehouse merchant, its buyers/operators/support team and customers.
Problem hypothesis: spreadsheet transfers, purchasing, counts and returns create reconciliation work. No merchant interview was conducted. Repository observation: a shared stock ledger and refund engine already provide the correct extension boundary.
Outcome: complete operational journeys without duplicate stock, overselling or duplicate financial settlement.
Non-goals: live supplier ordering, carrier labels, jurisdictional tax services or unapproved financial effects.

Order: transfers -> supplier purchasing -> cycle counts -> customer self-service. This prioritizes conservation risk, inbound dependencies, discrepancy control, then customer-facing settlement. Estimates below are learning sessions, not measured build duration. All implementation tickets are DELEGATE under the user's build instruction; learner critique, explain-back, independent variation and external review remain unassessed.

Shared criteria: forms show loading/disabled submit and actionable server errors; empty lists offer a next action; commands check current state, tenant and actor permissions in a transaction; retries reuse an idempotency key. Counts explicitly reject stale inventory versions. Other workflows revalidate current outstanding quantities. Permission and invalid-state failures must change neither ledger nor workflow.

Every measure below has a **missing real-user baseline**. Targets are hypotheses for a pilot, not observed achievements.

## F1 -> Warehouse transfers
### F1-S1 Request and approve
As an inventory manager, I want to commit stock to a receiving warehouse so that it can be replenished without consuming customer commitments.
1. Given distinct active same-merchant warehouses and available units, when a request is approved, then source held increases once and status is approved.
2. Given concurrent checkout demand or shortage, approval preserves nonnegative availability and reports shortage if it cannot succeed.
3. Foreign warehouse IDs and unauthorized roles produce typed failures with no movement.
Ticket F1-T1, 1-2 sessions. Ownership: Fulfil; dependencies: catalog/inventory; competencies: conservation and transactions. Excludes carrier booking. Code: Operations.cs CreateTransfer/ApproveTransfer; Admin.tsx. Check: integration.mjs transfer and tenant assertions.
Measure: request-to-approval time; target 50% below the observed manual baseline; time five representative tasks.

### F1-S2 Dispatch and receive
As a warehouse operator, I want to record dispatch and partial arrival so that each location knows what is sellable.
1. Given approved stock, dispatch removes source onHand and its transfer hold together, creating outstanding transit.
2. A partial receipt adds only accepted units to destination stock; remaining transit stays outstanding.
3. Replaying a receipt key does not add stock again; over-receipt and wrong-warehouse operations fail.
Ticket F1-T2, 1-2 sessions. Competencies: idempotency and workflow design. Dependencies: F1-S1; code: Operations.cs and admin transfer actions. Check: partial/duplicate receipt and final reconciliation.
Measure: unexplained unit differences; target zero in twenty controlled transfer exercises.

### F1-S3 Resolve exceptions
As an inventory manager, I want explicit cancellation/loss handling so that unresolved stock does not disappear.
1. An undispatched cancellation releases the hold once.
2. A dispatched transfer cannot be cancelled as though stock returned; receive it, create a reverse transfer after receipt, or document loss.
3. Loss cannot exceed outstanding transit; damaged transit never becomes sellable.
4. Open transfer age and unresolved quantities remain visible for investigation.
Ticket F1-T3, one session. Competencies: exception handling and audit. Code: CancelTransfer/TransferLoss. Check: integration loss and reconciliation. Transfers record a responsible administrator and editable next action; the list/detail exposes creation age and follow-up.
Measure: unresolved age; target daily review with no unowned incidents during pilot.

## F2 -> Supplier purchasing
### F2-S1 Explain suggestions
As a buyer, I want warehouse-specific reorder inputs so that I can justify a purchase.
1. At/below threshold, the report shows available, approved supplier outstanding, destination transit, target and suggested quantity with an as-of timestamp.
2. Draft/cancelled supply is excluded; accepted receipts reduce outstanding inbound.
3. Reading repeatedly creates no PO; buyers explicitly prepare drafts.
Ticket F2-T1, one session. Ownership: Fulfil purchasing; competencies: boundaries and explainable calculations. Code: ReadApi replenishment; Panels.tsx. Depends on transfer transit policy. No automatic purchasing.
Measure: single-SKU draft preparation time; proposed under two minutes in moderated tasks.

### F2-S2 Prepare and approve
As a buyer, I want supplier, destination, quantity and USD cost reviewed so that a draft cannot silently commit purchasing.
1. Valid same-merchant data creates a draft with submitted line/cost snapshots.
2. Authorized approval records its approver and state once; invalid roles/data fail.
3. Local approval does not claim supplier acceptance or send an external purchase.
Ticket F2-T2, 1-2 sessions. Competencies: workflow boundaries and authorization. Code: supplier and PO commands/Admin.tsx. Check: integration supplier/create/approve.
Measure: duplicate/unauthorized approval effects; target zero in controlled exercises.

### F2-S3 Receive partial shipments
As a receiving operator, I want to enter accepted quantities so that only sellable goods become available.
1. An approved partial receipt appends linked positive adjustments and leaves the remainder outstanding.
2. Duplicate keys do not restock; over-receipt fails.
3. Damaged/rejected goods are excluded from accepted quantities. Record an exception and expect replacement or cancel the balance with a reason.
4. Cancelling the remaining balance preserves prior accepted stock.
Ticket F2-T3, one session. Competencies: idempotent receiving and disposition. Code: ReceivePurchase/CancelPurchase. Check: integration partial/duplicate/over-receipt/cancel.
Measure: duplicate stock receipts; target zero during network-retry exercise.

## F3 -> Cycle counts
### F3-S1 Open a count
As a warehouse operator, I want a count baseline for a stock position so that my observation can be checked against ongoing work.
1. Creation records creator, warehouse, product, expected quantity and inventory version.
2. An operator cannot open another warehouse's session.
3. Movements remain allowed; this baseline uses visible expected stock, not blind counting.
Ticket F3-T1, one session. Competencies: concurrency policy and scope. Code: CreateCount/Admin.tsx. A lead can assign a same-merchant operator with matching warehouse access; defaults to creator. Assigned operators may submit their own sessions, and cannot approve their own observation.
Measure: preparation time; record five tasks before setting the pilot target.

### F3-S2 Submit an observation
As a counting operator, I want to submit quantity and reason so that discrepancies can be reviewed.
1. An open count accepts a nonnegative physical quantity and moves to submitted.
2. Movement after the baseline causes a stale-count conflict and recount instruction; it never overwrites newer stock.
3. A repeated submission key creates no additional discrepancy.
Ticket F3-T2, one session. Competencies: optimistic concurrency and error UX. Code: SubmitCount. Check: integration stale-count rejection.
Measure: stale observations silently applied; target zero in movement-during-count exercises.

### F3-S3 Independently resolve
As a second administrator, I want to review a current correction so that the ledger reflects verified physical stock.
1. The creator cannot approve their own correction.
2. Approval rechecks the version and appends one linked adjustment.
3. A count below reserved + held fails with a shortage instruction; commitments require resolution and recount.
4. Rejection remains auditable and changes no onHand.
Ticket F3-T3, one session. Competencies: independent control and recovery. Code: ApproveCount/RejectCount. Check: integration self-approval denial, second approver and reconciliation.
Measure: resolution time/age; baseline missing, proposed review in the next operational shift.

## F4 -> Customer returns and exchanges
### F4-S1 Request eligible items
As a customer, I want to select fulfilled items and a reason so that I can request a return without contacting support.
1. Only my order is visible through my account or protected guest session.
2. During the 30-day policy, claims cannot exceed fulfilled quantity less non-rejected claims.
3. Concurrent requests cannot claim the same eligible units twice.
4. Expired or ineligible requests explain failure without leaking another customer's data.
Ticket F4-T1, 1-2 sessions. Competencies: authorization and claim accounting. Code: RequestReturn, CustomerAccount, OrderDetail. Check: integration ownership and duplicate claim.
Measure: task completion; target 90% in moderated customer tests.

### F4-S2 Decide, receive and track
As a support agent, I want reasoned decisions and progress so that customers know the next step.
1. Approve/reject records a reason and notification; approval alone restocks/refunds nothing.
2. Receiving sellable goods restocks once and queues the original snapshot value for refund.
3. Unusable items can be received without adding sellable stock.
4. Pending provider outcomes stay visible; repeated receiving cannot repeat stock/refund.
Ticket F4-T2, 1-2 sessions. Competencies: asynchronous UX and financial consistency. Code: DecideReturn/ReceiveReturn/Worker and order views. Check: partial return/duplicate receipt/refund integration.
Measure: manual support steps; proposed one decision plus one receiving action.

### F4-S3 Separately settle an exchange
As a customer, I want a replacement with clear settlement so that I understand the original refund and new charge.
1. The replacement belongs to the merchant and links to a received original return.
2. Explicit checkout rechecks current price/stock and uses the existing payment saga.
3. Repeated confirmation cannot create a second replacement order.
4. A failed replacement leaves the received original return intact; refund and new payment are independently visible.
Ticket F4-T3, 1-2 sessions. Competencies: saga composition and consent. Code: PayExchange/OrderDetail. No off-session charge; no replacement hold before confirmation.
Measure: ability to explain settlement, proposed 90% in moderated tasks; authentic Stripe validation remains external.

## Invariants and review
All stories retain original inventory, tenant, idempotency, workflow, immutable-money, refund-capacity, recovery and audit invariants. Extensions: source + destination + transit + explicit loss conservation; inbound is not sellable; count corrections preserve commitments; return claims cannot double-spend eligible quantities. Map observed test evidence in VERIFICATION.md.

Discovery script: demonstrate today's process, describe the last mismatch, time a transfer/receipt/count/return, name exception owners, and test the proposed vocabulary. Record real observations separately from these hypotheses. Before an independent extension, critique one missing failure case per epic, propose a minimal slice, predict outcomes, implement it, explain alternatives and obtain review of the final revision.
