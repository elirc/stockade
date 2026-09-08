# Code walkthroughs and worked examples

Read one path, predict its behavior, run a small experiment, then explain the persisted result. The examples below are teaching scenarios, not claims that those exact quantities were seeded or tested during the build.

## 1. A browser command becomes a durable business result

Start at [Storefront](../src/components/Storefront.tsx) or [Admin](../src/components/Admin.tsx), then read [client helpers](../src/lib/client.ts), the [Next proxy](../src/app/api/[...path]/route.ts), [Program](../services/Fulfil/Program.cs), [Transactions](../services/Fulfil/Data/Transactions.cs), and [Commerce](../services/Fulfil/Services/Commerce.cs).

The client helper retains a command key across an uncertain network result. Fulfil derives the actor from authenticated server state, not a role or merchant field supplied in the payload. Transactions.Command binds the key to the actor/operation/payload digest and stores the outcome with the effects.

**Questions to answer in code:**

1. Where is the browser key saved, and when is it cleared?
2. What happens if the response is lost after the database commit?
3. What differs between retrying an identical payload and changing its quantity?
4. Which unique index prevents two committed receipts with the same merchant/key?
5. Which catalog/cart and integration-management endpoints are outside this command-receipt contract?

**Experiment:** read [the retry test](../tests/command-retry.test.ts), then draw the uncertain-response timeline before running it. Show why a disabled submit button cannot provide the same guarantee. Do not assume that all mutation endpoints inherit command idempotency.

## 2. Checkout, capture, shipment and a return

Follow Commerce.Checkout, [Pricing](../services/Fulfil/Services/Pricing.cs), Worker.ProcessOrder/CompleteCapture, Commerce.Ship and Commerce.ReceiveReturn.

Assume one warehouse has ten physical units and no commitments. A customer buys two; payment is confirmed; one unit ships and is later received as a sellable return.

| Event | onHand | reserved | held | available |
|---|---:|---:|---:|---:|
| Opening adjustment | 10 | 0 | 0 | 10 |
| Checkout reserves two | 10 | 2 | 0 | 8 |
| Confirmed capture converts the commitment | 10 | 0 | 2 | 8 |
| Ship one | 9 | 0 | 1 | 8 |
| Receive that one sellable return | 10 | 0 | 1 | 9 |

Shipment and receipt append physical adjustments. Commitment conversion does not invent a physical arrival. The remaining unshipped unit is still held; receiving a return does not cancel it.

Before changing anything, inspect [Rules.Transitions](../services/Fulfil/Domain/Rules.cs). The normal order path begins reserved, then authorized, placed, paid, and partial/full fulfillment. Payment and fulfillment fields carry additional progress. A compact teaching path omits exceptional transitions; the dictionary and guards are authoritative.

**Experiment:** repeat a fulfillment or receipt with the original key and prove there is only one physical change. Then use a fresh key with an invalid quantity and verify that workflow, stock and history all remain unchanged.

**Explain-back:** distinguish reservation acceptance from confirmed payment and explain why checkout may return while payment is still pending.

## 3. Diagnose contention without guessing

Read [Admission](../services/Fulfil/Data/Admission.cs), Transactions.Run, Checkout and the [integration runner](../scripts/integration.mjs). Admission takes ordered resource stripes before opening the serializable snapshot. Commands can still conflict with other workflows or worker updates; the transaction and constraints remain necessary.

The recorded 500/100 gate failed. Its eventual nonnegative snapshot is not a substitute for complete responses or cross-record reconciliation.

Instrument distinct intervals:

```text
request arrival
  -> authentication / actor lookup
  -> admission queue
  -> lock connection and database session lock
  -> transaction opening
  -> business queries and mutation
  -> retry attempts, if any
  -> commit and receipt
  -> response
  -> asynchronous authorization/capture completion
```

Capture request/run IDs, duration, retry count, outcome and relevant pool/lock/resource measurements. Exclude credentials and payment secrets.

**Experiment:** use smaller loads to identify a bottleneck, then rerun the original 500 simultaneous attempts after a justified change. Keep queue time in the reported latency. Count sold-out, server errors and transport failures separately. A timeout is an unknown client outcome, not proof that the order was rejected.

For this investigation, inspect database waits and query plans as well as application traces. Raising a client timeout may help observe completion in a diagnostic run; it does not satisfy the unchanged performance target. See tickets A-01 and A-02 in [next steps](NEXT_STEPS.md).

## 4. Unknown payment and crash recovery

Read [Payments](../services/Fulfil/Services/Payments.cs) together with Worker.ProcessOrder, Stage, Unknown, CompleteCapture and ProcessRefund. Existing simulator inputs include sim_success, sim_decline and sim_capture_fail. They do not prove authentic Stripe behavior or every network/crash sequence.

The useful failure point is between a provider accepting an operation and Stockade persisting that result. Reusing the same durable provider identity lets recovery reconcile the prior operation. Generating a new charge/refund identity can create a second financial effect.

**Exercise to implement in an isolated test harness:** create a controllable provider double that records an accepted effect and then throws a timeout. Restart the worker or retry the workflow. Assert one provider effect, preserved stock/refund capacity during uncertainty, eventual reconciliation and an auditable outcome. This harness is proposed learning work; it is not an existing verified simulator mode.

**Explain-back:** identify the database transaction boundaries on both sides of the network call. Explain why unknown authorization must not be treated as a decline, and why a void request can require capture/refund reconciliation if capture already happened.

## 5. Refund capacity and return rounding

Read Rules.ReturnValue, Commerce.ReserveRefund, Commerce.ReceiveReturn and Worker.ProcessRefund. Also inspect the financial_balance database check.

Suppose a captured order has captured = 1,000 cents, refunded = 200 and refundPending = 300. Only 500 cents remain available for a new refund request. If two concurrent requests each ask for 400, both must not reserve capacity successfully. A pending refund that times out continues to consume its capacity until its provider outcome is resolved.

For rounding, take three units at 1,000 cents each, one cent total discount and zero tax. Merchandise value is 2,999 cents. Cumulative return allocation produces 999, 1,000 and 1,000 cents for three one-unit returns. Their total equals one three-unit return. This example excludes shipping; inspect the current shipping-refund policy separately.

**Experiment:** extend [RulesTests](../tests/Fulfil.Tests/RulesTests.cs) with an unfamiliar partial-return order and fractional tax allocation. Change the current catalog price and confirm that the old order's snapshots remain authoritative.

**Explain-back:** distinguish the original return refund from the separately confirmed exchange purchase. Show where changed replacement pricing is rejected before creating an order.

## 6. Transfer and purchasing conservation

Follow CreateTransfer, ApproveTransfer, DispatchTransfer, ReceiveTransfer and TransferLoss in [Operations](../services/Fulfil/Services/Operations.cs).

A transfer of four from a warehouse holding ten physical units to an empty warehouse evolves as follows:

| Event | Source physical | Destination physical | Outstanding transit | Explicit loss | Conserved total |
|---|---:|---:|---:|---:|---:|
| Start | 10 | 0 | 0 | 0 | 10 |
| Approve: source holds four | 10 | 0 | 0 | 0 | 10 |
| Dispatch | 6 | 0 | 4 | 0 | 10 |
| Receive two | 6 | 2 | 2 | 0 | 10 |
| Record loss of two | 6 | 2 | 0 | 2 | 10 |

After approval, available source stock is six even though physical stock remains ten. Dispatch clears that transfer hold while reducing physical stock. After dispatch, pretending cancellation puts four units back would break the record of where goods are.

Purchasing has a different origin: an approved PO is an expectation, not existing stock moving between warehouses. Read ReceivePurchase and RejectGoods. Accepted quantities add stock; rejected goods do not. A suggestion does not execute supplier ordering.

**Experiment:** predict the effect of a duplicate partial receipt and an over-receipt with a new key. Prove both balance and audit behavior, then run reconciliation.

## 7. Counts: optimistic versioning and independent control

Follow CreateCount, SubmitCount and ApproveCount. Identify who may observe, who may approve, and what inventory version is recorded.

A baseline can become stale even when the displayed onHand has not changed: reservation/hold movement can increment the position version. A fresh count below reserved + held cannot be forced through simply because someone observed fewer units.

**Experiment:** open a count, create a commitment, and submit the old baseline. Then perform a current count and attempt self-approval. Use a second authorized administrator for a legitimate correction. Verify an appended adjustment rather than rewritten history.

**Explain-back:** describe the operational response to a real shortage. The expected response is investigation, commitment resolution/reallocation and recount; it is not removal of a database constraint.

## 8. Tenant scope, events and the UI boundary

Use [Integrations](../services/Fulfil/Services/Integrations.cs), [ReadApi](../services/Fulfil/Services/ReadApi.cs), [integration security tests](../tests/Fulfil.Tests/IntegrationSecurityTests.cs) and [the API contract](../docs/API.md).

Trace one foreign-order lookup, one revoked key and one signed event. Distinguish authentication, authorization, replay protection and idempotency. Verify that a consumer records an event identity durably before treating delivery as a new effect.

In the UI, follow [OrderDetail](../src/components/OrderDetail.tsx) and [shared controls](../src/components/ui.tsx). Loading, disabled submission, visible errors, keyboard focus and server revalidation are part of the workflow. Three browser journeys do not cover all dialogs, role combinations, screen readers or financial effects.

## A repeatable debugging record

For every exercise, keep: expected state, exact request identity, initial database facts, relevant file/function, observed result, invariant check, rejected explanations and the next discriminating experiment. Use [the learning template](LEARNING_LOG_TEMPLATE.md). Explain what the evidence cannot establish as carefully as what it establishes.
