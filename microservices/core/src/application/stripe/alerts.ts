/**
 * Single structured alert sink for the Stripe payments paths (spec 17 /
 * Phase C). Every money-side event that needs a human — a refund, a dispute
 * (chargeback), a failed recurring charge (dunning), an ending trial — emits
 * one greppable line through here so ops can wire ONE CloudWatch Logs metric
 * filter (`[stripe:alert]`) + alarm instead of chasing scattered log strings.
 *
 * `severity: "critical"` lines go to console.error (page-worthy: money moved
 * the wrong way / fraud signal); `"warn"` goes to console.warn (attention, not
 * urgent: dunning, trial ending). The prefix is identical so a single metric
 * filter catches both; the `severity` field lets the alarm split urgency.
 *
 * This does NOT deliver user-facing notifications — in-app/push for dunning +
 * trial-ending is the M9 milestone (the enum + push pipeline don't exist yet).
 * This is the ops-alert layer the audit called the minimum bar.
 */
export type StripeAlertSeverity = "warn" | "critical";

export function emitStripeAlert(
  kind: string,
  severity: StripeAlertSeverity,
  detail: Record<string, unknown>,
): void {
  const line = `[stripe:alert] ${JSON.stringify({ kind, severity, ...detail })}`;
  if (severity === "critical") {
    console.error(line);
  } else {
    console.warn(line);
  }
}
