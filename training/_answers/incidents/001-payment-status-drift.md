# INC-001 — sealed answer

## Root cause

`services/Fulfil/Services/Payments.cs:79`, the `Parse` method's status-mapping switch, on
`training/incidents/001-payment-status-drift` (commit `5b0a209`):

```diff
- { "requires_capture" => "authorized", "succeeded" => "captured", "requires_action" => "action_required", "canceled" => "voided", _ => "unknown" }
+ { "requires_capture" => "authorized", "succeeded" => "captured", "requires_action" => "requires_action", "canceled" => "voided", _ => "unknown" }
```

Stripe's raw `payment_intent.status` value `"requires_action"` is no longer translated into Stockade's
internal vocabulary — it's passed straight through as `"requires_action"`, which is not a value any other
part of the system recognizes.

## Mechanism, end to end

1. Customer checks out with a card requiring 3DS. `Worker.ProcessOrder` calls `payments.Authorize(order)`
   (`Worker.cs:83`), which for `Payments:Mode=Stripe` calls `Post("payment_intents", ...)` then
   `Parse(json)` (`Payments.cs:19-30`). Stripe returns `status: "requires_action"`. `Parse` now returns
   `PaymentResult { State = "requires_action" }` instead of `"action_required"`.
2. Back in `Worker.cs:84-90`, the result is written straight onto the order: `o.PaymentState = result.State`
   (now `"requires_action"`), and the guard `if (result.State == "action_required" && ...) Rules.Transition(o,
   "action_required")` does **not** fire, because the string no longer matches. `o.State` stays `"reserved"`.
3. On the next worker tick, the recovery scan (`Worker.cs:24`) filters on
   `{"pending","authorizing","authorized","capturing","unknown","action_required","void_pending"}`.
   `"requires_action"` is not in that set, so **the order is never selected again**. It drops out of the
   reconciliation loop entirely, silently, with no exception and no log line — `ProcessOrder` is simply never
   called for this order ID again.
4. The 15-minute reservation-expiry path (`Expire`, `Worker.cs:152-167`) also doesn't touch it: it only
   expires orders whose `PaymentState == "pending"` with no `ProviderId` and no `PaymentAttempts` — this order
   already has a `ProviderId` and a `PaymentAttempts` row from the authorize call, so it's correctly excluded
   from that path (expiry isn't meant to cancel an order Stripe is actively tracking) — it's just that nothing
   *else* picks it up either.
5. Net effect: the customer's bank hold sits open (Stripe itself will eventually expire the PaymentIntent, but
   Stockade never notices either way), the storefront shows whatever "processing" UI it shows for a non-final
   state, no confirmation email goes out (no `Emit`/outbox event is ever queued for this order after the
   initial `"reserved"` event), and the order never becomes fulfillable or cancellable through any normal
   admin action tied to state transitions.

## Why `Fulfil.Tests` stayed green

`Payments.Parse` is only reached when `Payments:Mode=Stripe` (`Payments.cs:13,19-30` — every method
short-circuits to a hardcoded `PaymentResult` under `Mode == "Simulator"` *before* calling `Parse`). The test
suite and local dev run under the simulator, which never constructs a `"requires_action"`/`"action_required"`
result at all (`Payments.cs:14-18`: only `"authorized"` or a `PaymentDeclined` throw). There was no test that
called `Payments.Parse` directly with a `requires_action` Stripe payload, and no integration test that forced
`Payments:Mode=Stripe` against a fake HTTP handler returning that status. The one boundary this bug lives in
was structurally untested (this is `training/_answers/review.md` finding 3, found independently by reading the
code, not by seeing this incident first).

## Why `stuckSagas` never flagged it

`stuckSagas` (`ReadApi.cs`, `health` resource) counts `Orders` where `Attempts >= 12`. `Attempts` is only
incremented by `Unknown()` (`Worker.cs:125`), which runs when an exception is thrown or a provider result is
ambiguous. This bug never throws and never calls `Unknown` — the order is simply excluded from the query that
would have processed it, silently, with `Attempts` frozen at whatever it was (0, since authorize succeeded on
the first try). A health check built on "how many times did we retry" cannot see a saga that never gets
picked up to retry in the first place.

## Fix

Revert the mapping:

```csharp
"requires_action" => "action_required",
```

If the original motivation (matching Stripe's own dashboard language for support) is worth keeping, do it in
the **admin UI's display layer** (e.g. a label lookup in `Badge`/`OrderDetail.tsx`), never in the value stored
in `Order.PaymentState` and compared against internally.

## Regression test

Add a test that does not go through the Simulator:

```csharp
[Fact]
public void Parse_MapsRequiresAction_ToActionRequired()
{
    var json = JsonNode.Parse("""{"id":"pi_test","status":"requires_action"}""");
    var result = Payments.Parse(json); // expose Parse as internal + [InternalsVisibleTo] for the test project,
                                        // or test through a fake HttpMessageHandler + Mode=Stripe end-to-end
    Assert.Equal("action_required", result.State);
}
```

Better still, add one parameterized test that asserts **every** Stripe status the switch handles round-trips
to the exact string `Rules.Transitions` and the recovery-scan filter (`Worker.cs:24`) expect — so a future
rename anywhere in that chain fails a test instead of shipping.

## Postmortem (one paragraph)

The payment-state vocabulary (`"pending"`, `"authorizing"`, `"action_required"`, `"captured"`, ...) is a bare
`string` duplicated across `Payments.Parse`, `Rules.Transitions`, five sites in `Worker.cs`, and
`Integrations.cs`'s Stripe webhook handler, with nothing enforcing agreement between them, and the one
function that produces the value from an external system (`Payments.Parse`) is the one function the test
suite structurally cannot reach, because the Simulator used everywhere else bypasses it entirely. The fix for
*this* incident is a one-line revert; the fix for the *class* of incident is (a) a shared `enum`/constant set
referenced everywhere instead of string literals, so a rename is a compiler error, not a silent drift, and
(b) at least one test that exercises `Payments.Parse` against real Stripe-shaped JSON without going through
the simulator, so the riskiest translation boundary in the saga has any coverage at all.
