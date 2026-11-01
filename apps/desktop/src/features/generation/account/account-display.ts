import type { AllowanceSummary } from "@/bindings/generation";

/** Keep purchased allowance distinct from the remaining refillable allowance. */
export function allowanceText(usage: AllowanceSummary): string {
  const remaining = `${usage.isNegative ? "−" : ""}${usage.percent}%`;
  return usage.purchasedPercent > 0 ? `${remaining} (+${usage.purchasedPercent}%)` : remaining;
}

/** Express the sampled recovery duration in half-hour increments, rounded up. */
export function recoveryHours(seconds: number): number {
  return Math.ceil(seconds / 1800) / 2;
}
