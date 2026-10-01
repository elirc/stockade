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
