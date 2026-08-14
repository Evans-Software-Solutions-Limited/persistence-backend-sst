import type { AnalyticsEventInput, AnalyticsEventName } from "./events";

/**
 * Map a RevenueCat webhook event to a first-party analytics event (spec-30
 * R1.4/R1.5). Pure — no DB, no throw — so the webhook's emit call can never
 * fail the handler.
 *
 * Fields read here (`price`, `currency`, `period_type`, `store`, `product_id`)
 * are parsed defensively off the raw event body and are used ONLY for
 * instrumentation. The webhook still decides entitlements from the authoritative
 * REST re-fetch (`revenueCatSync`), never from these — so a malformed/absent
 * value degrades the analytics row, not the subscription state.
 */
export interface RevenueCatAnalyticsEvent {
  type?: unknown;
  app_user_id?: unknown;
  period_type?: unknown;
  price?: unknown;
  currency?: unknown;
  store?: unknown;
  product_id?: unknown;
}

/** RC event.type → our event name. Returns null for types with no funnel meaning. */
function rcTypeToName(
  type: string,
  periodType: string | null,
): AnalyticsEventName | null {
  switch (type) {
    case "INITIAL_PURCHASE":
      // A trial start and a straight paid purchase both arrive as
      // INITIAL_PURCHASE; `period_type` distinguishes them.
      return periodType === "TRIAL"
        ? "trial_started"
        : "subscription_purchased";
    case "NON_RENEWING_PURCHASE":
      return "subscription_purchased";
    case "RENEWAL":
      return "renewal";
    case "CANCELLATION":
      return "cancellation";
    case "EXPIRATION":
      return "expiration";
    default:
      // PRODUCT_CHANGE / TRANSFER / UNCANCELLATION / BILLING_ISSUE / etc. carry
      // no funnel event this cycle.
      return null;
  }
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function asFiniteNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Build the analytics event for a RevenueCat webhook event, WITHOUT the user id
 * (the handler supplies that after its anonymous/foreign-id checks). Returns
 * null when the event type has no funnel meaning.
 */
export function mapRevenueCatEventToAnalytics(
  event: RevenueCatAnalyticsEvent,
): Omit<AnalyticsEventInput, "userId"> | null {
  if (typeof event.type !== "string") return null;
  const periodType = asString(event.period_type);
  const name = rcTypeToName(event.type, periodType);
  if (name === null) return null;

  const value = asFiniteNumber(event.price);
  const currency = asString(event.currency);
  const store = asString(event.store);
  const productId = asString(event.product_id);

  const properties: Record<string, unknown> = {};
  if (value !== null) properties.value = value;
  if (currency !== null) properties.currency = currency;
  if (store !== null) properties.store = store;
  if (productId !== null) properties.product_id = productId;
  if (periodType !== null) properties.period_type = periodType;

  // Purchases originate in the mobile app; `source: "app"` drives
  // `action_source: "app"` on the Meta side.
  return { name, source: "app", properties };
}
