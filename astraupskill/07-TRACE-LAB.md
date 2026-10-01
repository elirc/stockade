# Trace one exhausted refund to its label

Start with merchant A's authenticated owner and a pending refund whose attempt count is twelve. Follow Session.Account to the resolved merchant identifier. Enter the health branch and evaluate each refund predicate against that row. It contributes one to pendingRefunds, zero to retryableRefunds, and one to stuckRefunds.

Pass the returned object into healthStats. Locate the card whose value reads stuckRefunds and record its label and help text. The card directs the operator to an order action; it does not submit that action itself. Mark that separation on your trace so a summary view is not mistaken for a recovery command.

Repeat with the same row at eleven attempts. Its contribution moves to the retryable group. Then change state to succeeded while leaving attempts at twelve. It contributes to neither pending group. Finally, switch to merchant B's authenticated owner and confirm A's row contributes nothing to B's counts.

For a debugging exercise, replace the returned recovery field with the old pending total only in a local fixture and run the presentation assertion. Explain which part of the visible behavior changes and why a backend-only test would not detect the mapping error. Restore the fixture afterward. This trace connects identity, query classification, and presentation without assuming that a live payment provider or browser session participated in the check.

## Source excerpt

From [src/lib/health.ts](../src/lib/health.ts).

```ts
import { list, num, type Row } from "./client";

export interface HealthStat {
  label: string;
  value: number | string;
  help?: string;
}

export function healthStats(data: Row): HealthStat[] {
  return [
    { label: "Stuck payments", value: num(data, "stuckSagas") },
    { label: "Retryable refunds", value: num(data, "retryableRefunds") },
    {
      label: "Refunds needing retry",
      value: num(data, "stuckRefunds"),
      help: "Open the order and use the authorized Retry refund action.",
    },
    { label: "Dead letters", value: num(data, "deadLetters") },
    {
      label: "Latest inventory differences",
      value: list(data, "items")[0] ? num(list(data, "items")[0]!, "differences") : "?",
    },
  ];
}
```

## Course navigation

[README](README.md) / [01-CODEBASE-MAP](01-CODEBASE-MAP.md) / [02-CONCEPTS](02-CONCEPTS.md) / [03-WORKED-CHANGE](03-WORKED-CHANGE.md) / [04-TESTING-AND-DEBUGGING](04-TESTING-AND-DEBUGGING.md) / [05-PRACTICE](05-PRACTICE.md) / [06-SOLUTIONS-AND-REVIEW](06-SOLUTIONS-AND-REVIEW.md) / [07-TRACE-LAB](07-TRACE-LAB.md) / [VERIFICATION](VERIFICATION.md)
