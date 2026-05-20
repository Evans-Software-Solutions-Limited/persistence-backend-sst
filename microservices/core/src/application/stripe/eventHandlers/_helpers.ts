import type Stripe from "stripe";

/**
 * Helpers shared across the Stripe webhook event handlers. Pure functions
 * — no side effects, no DB or SDK calls — so they're trivially unit-
 * testable and reusable from both the inbound webhook path and the
 * outbound subscription endpoints (next milestone).
 */

/**
 * Map a Stripe `Subscription.status` to our local `payment_status` text
 * column.
 *
 * Used by handlers where the status mapping is the simple version (no
 * scheduled-cancellation grace period). For `subscription.updated`,
 * use `mapStripeStatusToPaymentStatusForUpdate` instead — it preserves
 * "active" until the actual cancellation date passes.
 */
export function mapStripeStatusToPaymentStatus(
  status: Stripe.Subscription.Status,
): string {
  switch (status) {
    case "trialing":
      return "trialing";
    case "active":
      return "active";
    case "past_due":
      return "past_due";
    default:
      return "pending";
  }
}

/**
 * Map a Stripe subscription's status to `payment_status` for the
 * `subscription.updated` handler specifically. Differs from the plain
 * mapping in two ways:
 *
 *   1. A `canceled` / `incomplete_expired` subscription with
 *      `canceled_at` set and `current_period_end` still in the future is
 *      a SCHEDULED cancellation — the user still has paid access until
 *      that date, so we keep `payment_status = "active"` until the date
 *      passes. The legacy `computeIsFreeTier` defensive collapse only
 *      triggers AFTER expires_at passes, so this preserves the UI's
 *      "active until X" badge correctly.
 *   2. `unpaid` collapses to "expired" — a paywall-shaped status that
 *      mobile renders as a cancelled tier with no grace.
 *
 * Mirrors the legacy stripe-webhook line 201-229.
 */
export function mapStripeStatusToPaymentStatusForUpdate(
  subscription: Stripe.Subscription,
): string {
  const status = subscription.status;
  if (status === "trialing") return "trialing";
  if (status === "active") return "active";
  if (status === "past_due") return "past_due";

  if (status === "canceled" || status === "incomplete_expired") {
    // Scheduled cancellation: user explicitly cancelled but paid period
    // hasn't ended. Stripe leaves the subscription's status at "active"
    // until the period lapses naturally — but on cancellation events
    // Stripe sets `canceled_at` immediately.
    const periodEnd = readCurrentPeriodEnd(subscription);
    if (subscription.canceled_at && periodEnd !== null) {
      const nowSeconds = Math.floor(Date.now() / 1000);
      if (periodEnd > nowSeconds) return "active";
      return "cancelled";
    }
    return "cancelled";
  }

  if (status === "unpaid") return "expired";

  return "pending";
}

/**
 * Convert a Stripe unix-seconds timestamp to a JS Date. Returns `null`
 * for null/undefined/0. Drizzle's `timestamp` columns accept Date
 * directly — we don't need ISO-string round-trips like the legacy.
 */
export function unixSecondsToDate(
  seconds: number | null | undefined,
): Date | null {
  if (seconds === null || seconds === undefined || seconds === 0) return null;
  return new Date(seconds * 1000);
}

/**
 * Read `current_period_end` from a subscription, transparently handling
 * the API-version migration where Stripe moved the field off the
 * top-level Subscription onto its items.
 *
 * - Older API versions (≤ 2024-12-18): `subscription.current_period_end`
 * - Newer versions:                    `subscription.items.data[0].current_period_end`
 *
 * The SDK's TypeScript types only expose the items-level field, but
 * runtime payloads can carry either depending on the dashboard webhook
 * endpoint's configured API version. We runtime-check both forms; if
 * neither is present (rare — pre-billing subs with no items can do
 * this), returns `null` so the caller falls through to the
 * cancellation-date fallback.
 */
export function readCurrentPeriodEnd(
  subscription: Stripe.Subscription,
): number | null {
  const legacy = (
    subscription as unknown as { current_period_end?: number | null }
  ).current_period_end;
  if (typeof legacy === "number" && legacy > 0) return legacy;
  const itemEnd = subscription.items?.data?.[0]?.current_period_end;
  return typeof itemEnd === "number" && itemEnd > 0 ? itemEnd : null;
}

/**
 * Extract the subscription id from an Invoice across API versions.
 *
 * - Older versions: `invoice.subscription` as string-or-object
 * - Newer versions: `invoice.parent.subscription_details.subscription`
 *
 * Returns `null` for one-off invoices that aren't tied to a
 * subscription — caller logs + skips cleanly.
 */
export function readInvoiceSubscriptionId(
  invoice: Stripe.Invoice,
): string | null {
  const legacy = (
    invoice as unknown as { subscription?: string | { id?: string } | null }
  ).subscription;
  if (typeof legacy === "string" && legacy.length > 0) return legacy;
  if (legacy && typeof legacy === "object" && typeof legacy.id === "string") {
    return legacy.id;
  }
  const parent = (
    invoice as unknown as {
      parent?: {
        subscription_details?: { subscription?: string | null } | null;
      } | null;
    }
  ).parent;
  const fromParent = parent?.subscription_details?.subscription;
  return typeof fromParent === "string" && fromParent.length > 0
    ? fromParent
    : null;
}

/**
 * Resolve the effective `expires_at` for a subscription update.
 *
 * Precedence mirrors legacy stripe-webhook lines 235-246:
 *   1. `cancel_at` — explicit scheduled-cancellation effective date
 *      (Stripe sets this when the user clicks Cancel in a portal).
 *   2. `current_period_end` — normal billing-cycle end.
 *   3. `items.data[0].current_period_end` — fallback for newer Stripe
 *      API versions where `current_period_end` moved to the item level.
 *      Without this, switching the webhook endpoint to a newer API
 *      version would drop the expires_at silently.
 */
export function resolveExpiresAt(
  subscription: Stripe.Subscription,
): Date | null {
  if (subscription.cancel_at) {
    return unixSecondsToDate(subscription.cancel_at);
  }
  return unixSecondsToDate(readCurrentPeriodEnd(subscription));
}

/**
 * Extract the `supabase_user_id` from a Stripe subscription's metadata.
 * Returns `null` when missing — caller logs + returns 200 without
 * touching the DB (the subscription was likely created out-of-band
 * before the metadata convention was established).
 */
export function readUserIdFromMetadata(
  subscription: Stripe.Subscription,
): string | null {
  const userId = subscription.metadata?.supabase_user_id;
  if (typeof userId !== "string" || userId.length === 0) return null;
  return userId;
}
