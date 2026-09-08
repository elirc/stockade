# Upskilling lab
The project was built in DELEGATE mode at your request. Code/tests are learning resources, not proof of independent competence. Mark exercises Not started, Attempted, Remediated or Demonstrated from actual artifacts.

## Follow one order
Run the app and predict onHand/reserved/held through checkout, capture, partial shipment and return. Follow Storefront -> Next proxy -> Commerce.Checkout -> Transactions.Command -> Worker.ProcessOrder. Identify where each transaction ends before a provider call. Draw the legal state graph from Rules.cs.

Keep a notebook: story ID, prediction, files inspected, command/test, observed result, mismatch explanation and revision link. Exclude credentials/customer data.

## Work through the hard parts
**Two buyers, one unit.** Explain why browser validation and in-memory locks cannot prevent overselling across two API processes. Serializable transactions retry against current stock; the CHECK constraint is the final invariant. Run the 500-attempt/100-unit fixture and inspect persisted balances, not just HTTP counts.

**Unknown charge.** A timeout does not prove decline. Trace a crash after provider acceptance but before the database result. Identify the durable order/refund IDs and stable provider keys used by recovery. Explain why stock/refund capacity must remain committed.

**Return rounding.** A line stores its total original discount and tax. Cumulative allocation distributes fractional minor units across partial returns. Test three units with a one-cent discount, return individually and together, then change the catalog price and prove snapshots remain authoritative.

**Transfer conservation.** Write source + destination + transit + explicit loss before/after approval, dispatch, partial receipt and loss. Add an over-receipt test that verifies no ledger entry. Explain why expected supplier goods cannot satisfy checkout.

**Physical counts.** Open a count, move stock and submit the old count. Explain why the version matters even if a commitment change leaves physical onHand unchanged. Use a different administrator for a current correction; attempt a count below committed stock.

## Milestone evidence
| Milestones | Practice | Artifact |
|---|---|---|
| M0-M1 | Environment, catalog/cart | Reproducible setup and ownership explanation |
| M2-M3 | States and concurrency | State graph, invalid transition and contention report |
| M4-M5 | Pricing and payments | Tampered-total test and crash/retry walkthrough |
| M6-M8 | Fulfillment, promotions, refunds | Partial shipment, rounding and refund-race evidence |
| M9-M10 | Recovery and public API | Delivery retry, signature/scope/revocation contracts |
| M11-M12 | Performance, security, release | Measured profile, restore drill, independent review |
| M13 | Discovery | Real observations separated from hypotheses |
| M14-M15 | Transfers and purchasing | Conservation proof and duplicate-receipt tests |
| M16 | Counts | Stale version, shortage and second-approver evidence |
| M17 | Customer returns | Ownership, keyboard journey and settlement explanation |
| M18 | Independent extension | Unfamiliar variation, review and product observation |

## Independent variations
Choose one: bulk atomic receipts; warehouse-specific reorder lead time; a read-only support SDK scope; or damaged-return inspection without sellable stock. Write a user story and Given/When/Then criteria, name invariants, predict failures, then propose a minimal slice. Record assistance, defend an alternative design, link meaningful tests and obtain review by someone who did not author the code.

Rubric: 0 cannot reproduce/explain; 1 substantial guidance; 2 independently implements familiar case and explains invariants; 3 handles unfamiliar failures and defends tradeoffs with evidence. A test pass, explain-back and independent review are separate artifacts. Current human assessment: **unassessed**.
