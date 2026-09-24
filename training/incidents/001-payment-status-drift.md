# INC-001 — Orders requiring 3DS/bank action never resolve

**Branch:** `training/incidents/001-payment-status-drift` (based on `HEAD` `7a9e422`)
**Severity:** SEV-2 (customer-visible, revenue-affecting, no data loss)
**Status:** Open — needs root cause

## Alert / symptom

On-call gets paged from a merchant support ticket, not from monitoring (there is no alert configured for
this — see "what we noticed" below):

> "Three customers this week say checkout is stuck on 'Confirm your payment with your bank' forever. They
> never get a confirmation email, the item never ships, but their bank app shows the hold is still there
> days later. Two of them gave up and re-ordered, so we have duplicate holds on the same card."

Support pulls three order numbers. In the admin panel, all three show:

- `State: authorized`
- `PaymentState` — support can't see this field directly, but `/api/v1/orders/{id}` (used to debug) returns
  a payment state that isn't one support recognizes from the runbook's list of normal states
- No `OrderEvent` rows after the initial `"reserved"` event
- `Attempts: 0` on all three orders

## What we noticed

- `GET /api/v1/data/health` → `stuckSagas` reads **0** for this merchant the entire time. The dashboard's
  "Stuck payments" tile never lit up.
- The reconciliation runs (`Reconciliations` table, visible on the Operational Health panel) show 0
  differences for inventory the whole time — this isn't a stock/reservation problem, the orders are just...
  not moving.
- All three orders used a card that Stripe's test/production 3DS flow classifies as requiring
  cardholder authentication (this merchant's live traffic includes EU cards, which commonly hit this).
- `Payments:Mode` in this environment is `Stripe`, not `Simulator` — this is a production/staging config, not
  local dev.
- The existing Fulfil.Tests suite is green. It ran in CI on the PR that shipped right before support started
  getting these reports.

## Suspect change

The most recent PR to touch the payments boundary before reports started:

```
commit 5b0a209
Author: (repo default)
Date:   (see branch)

    fix(payments): surface Stripe's own status name for requires_action

    Support asked why the "Payment status" column in the Stripe dashboard
    doesn't match our internal state. Pass the raw requires_action status
    straight through instead of relabeling it, so the two match up.

 services/Fulfil/Services/Payments.cs | 2 +-
 1 file changed, 1 insertion(+), 1 deletion(-)
```

## Your task

1. Find the root cause. State it in one sentence, with the exact line(s).
2. Trace the mechanism: what does the app do differently now vs. before this change, end to end, from the
   Stripe status string arriving to the order being visibly stuck?
3. Explain why `Fulfil.Tests` stayed green through this change. What test (if any existed) would have caught
   it, and why didn't the existing suite?
4. Explain why `stuckSagas` never flagged these orders, even after days.
5. Write the fix and a regression test that would have caught this specific bug.
6. Write a one-paragraph postmortem: what should change so this class of bug (not just this instance) is
   harder to reintroduce?

Sealed answer: `training/_answers/incidents/001-payment-status-drift.md` — don't open it until you've done
1–6 on your own.
