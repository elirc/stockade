# Separate query classification from presentation

The backend change preserves the old pending total and introduces two explicit CountAsync predicates. Each includes MerchantId and pending state. The only difference between the new predicates is Attempts less than twelve versus greater than or equal to twelve. Keeping that difference visible makes the boundary straightforward to review against the worker policy.

The frontend no longer presents all pending refunds as though they require the same response. healthStats emits Retryable refunds from retryableRefunds and Refunds needing retry from stuckRefunds. The latter includes help directing the user to the order's authorized Retry refund action. This is guidance, not a new mutation endpoint or an authorization bypass.

The mapping preserves the existing stuck-payment, dead-letter, and inventory-difference entries. It checks for an actual reconciliation item before reading differences, so a recorded zero remains zero while absent history uses the existing unknown marker. The presentation regression covers that zero case alongside the two refund labels.

Review the API and mapping together. A correct backend field paired with an old UI key can silently show the wrong number. Conversely, changing a label without changing the underlying query would preserve the operational confusion. The tests exercise these two responsibilities separately, and their combined evidence does not imply a browser click or provider refund was performed.

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
