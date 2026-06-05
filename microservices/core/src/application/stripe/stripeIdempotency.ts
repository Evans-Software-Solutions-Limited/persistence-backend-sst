/**
 * Idempotency-key derivation for outbound Stripe calls (spec 17 / Phase A,
 * closes audit HIGH-1).
 *
 * Stripe's at-least-once / asynchronous nature means a mobile timeout-and-
 * retry or a double-tap on "Subscribe" re-runs the whole outbound flow.
 * Without an `Idempotency-Key`, a retry creates a duplicate Stripe customer
 * / subscription — and at trial end, a second real charge. These helpers
 * produce stable keys so a retry of the SAME logical action collapses to a
 * single Stripe object, while genuinely different actions stay distinct.
 *
 * Two sources of the base key:
 *   1. Client-supplied (`clientKey`) — preferred. Mobile generates one
 *      stable UUID per user action and sends it on the request body; a
 *      client-level retry reuses it, giving end-to-end retry safety. (The
 *      mobile change to emit it is a follow-up; the field is optional so
 *      the backend ships independently.)
 *   2. Deterministic fallback — when no client key is sent, derive from the
 *      stable intent of the request. Two retries of the same intent derive
 *      the same key (Stripe dedupes); a different action (e.g. resubscribe
 *      after a full cancel, where the existing Stripe sub id differs)
 *      derives a different key.
 *
 * Stripe scopes idempotency by (key + endpoint + account), and stores the
 * first response for 24h. `opKey` namespaces the base per operation so the
 * distinct calls within one flow (customer create, PM attach, sub create…)
 * never collide, and a future refactor that moves a call to a different
 * endpoint can't accidentally share a key with another op.
 */

/** Stripe's idempotency keys must be <= 255 chars; we cap well under that. */
const MAX_KEY_LENGTH = 200;

export type StripeOp =
  | "customer"
  | "cust-update"
  | "pm-attach"
  | "sub-create"
  | "sub-update"
  | "sub-cancel";

/**
 * Normalise a client-supplied key: trim, reject empty / non-string, cap
 * length. Returns null when the input isn't a usable key (caller falls
 * back to the deterministic derivation).
 */
function normaliseClientKey(
  clientKey: string | null | undefined,
): string | null {
  if (typeof clientKey !== "string") return null;
  const trimmed = clientKey.trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, MAX_KEY_LENGTH);
}

/**
 * Base key for a subscription create/change/reinstate flow.
 *
 * Deterministic fallback joins the fields that distinguish one intent from
 * another:
 *   - `userId`           — scope to the acting user
 *   - `tierName`+`cycle` — the product being bought
 *   - `paymentMethodId`  — a PM swap is a new intent (defaults to "default"
 *                          for the no-PM change-of-tier path)
 *   - `existingExternalSubscriptionId` — the sub being acted on, or "new".
 *                          This is what makes a resubscribe-after-cancel
 *                          distinct from a retry of the same in-flight
 *                          attempt: after a full cancel the prior sub id is
 *                          gone, so the next subscribe derives a fresh key
 *                          rather than falsely deduping against the old one.
 */
export function deriveSubscriptionBaseKey(input: {
  clientKey?: string | null;
  userId: string;
  tierName: string;
  billingCycle: string;
  paymentMethodId?: string | null;
  existingExternalSubscriptionId?: string | null;
}): string {
  const client = normaliseClientKey(input.clientKey);
  if (client !== null) return client;
  const pm =
    typeof input.paymentMethodId === "string" &&
    input.paymentMethodId.length > 0
      ? input.paymentMethodId
      : "default";
  const existing =
    typeof input.existingExternalSubscriptionId === "string" &&
    input.existingExternalSubscriptionId.length > 0
      ? input.existingExternalSubscriptionId
      : "new";
  return [
    "sub",
    input.userId,
    input.tierName,
    input.billingCycle,
    pm,
    existing,
  ].join(":");
}

/**
 * Base key for a cancel flow. Deterministic fallback distinguishes by the
 * local subscription id being cancelled and the cancel mode (immediate vs
 * period-end) — so a retry of the same cancel dedupes, but flipping the
 * mode is a distinct action.
 */
export function deriveCancelBaseKey(input: {
  clientKey?: string | null;
  userId: string;
  localSubscriptionId: string;
  cancelImmediately: boolean;
}): string {
  const client = normaliseClientKey(input.clientKey);
  if (client !== null) return client;
  return [
    "cancel",
    input.userId,
    input.localSubscriptionId,
    input.cancelImmediately ? "now" : "period-end",
  ].join(":");
}

/**
 * Namespace a base key for a specific Stripe operation. Capped at
 * MAX_KEY_LENGTH so a long client key + suffix never exceeds Stripe's
 * limit.
 */
export function opKey(baseKey: string, op: StripeOp): string {
  return `${baseKey}:${op}`.slice(0, MAX_KEY_LENGTH);
}
