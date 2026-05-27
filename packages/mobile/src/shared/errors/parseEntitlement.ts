import type { EntitlementFeature } from "@/domain/models/entitlement";
import type { SubscriptionTierName } from "@/domain/models/subscription";
import type { ApiErrorEntitlementPayload } from "@/shared/errors";

/**
 * Wire shape of the backend's 402 entitlement-denied body. Mirrors
 * `WireEntitlementDeniedBody` in `sst-api.adapter.ts` — kept here
 * standalone so the sync-queue worker (which uses raw `fetch`, not the
 * adapter) can parse 402 responses without coupling to the adapter.
 *
 * Spec: specs/11-payments-subscriptions/design.md
 *       § Entitlement enforcement (M10.5) > 402 response shape
 *       · § Sync-queue entitlement handling (M10.6)
 *
 * Field origin:
 *   {
 *     "code": "ENTITLEMENT_DENIED",
 *     "error": "Subscription does not include this feature",
 *     "feature": "create_workout",
 *     "current_tier": "basic",
 *     "upgrade_to": "premium",
 *     "upgrade_price_monthly": 14.99
 *   }
 */
type WireEntitlementDeniedBody = {
  code?: unknown;
  error?: unknown;
  feature?: unknown;
  current_tier?: unknown;
  upgrade_to?: unknown;
  upgrade_price_monthly?: unknown;
};

/**
 * Parse a parsed-JSON 402 body into the camelCase entitlement payload, or
 * return `null` if the body is malformed (missing `code`, code mismatch,
 * or required wire fields missing/wrong-shaped).
 *
 * Strict on `feature` / `current_tier` (must be strings; absence drops
 * to null). Lenient on `upgrade_to` (may be null when already top-tier)
 * and `upgrade_price_monthly` (likewise null).
 *
 * Caller is responsible for the `response.json()` step — this is
 * deliberately pure (no fetch coupling, no I/O) so it can be exercised
 * with synthetic objects in unit tests and called from both the
 * adapter and the sync worker.
 */
export function parseEntitlementDeniedResponseBody(
  body: unknown,
): ApiErrorEntitlementPayload | null {
  if (body === null || typeof body !== "object") return null;
  const raw = body as WireEntitlementDeniedBody;
  if (raw.code !== "ENTITLEMENT_DENIED") return null;
  if (typeof raw.feature !== "string") return null;
  if (typeof raw.current_tier !== "string") return null;

  const upgradeTo =
    raw.upgrade_to === null || typeof raw.upgrade_to === "string"
      ? (raw.upgrade_to as string | null)
      : undefined;
  if (upgradeTo === undefined) return null;

  const upgradePriceMonthly =
    raw.upgrade_price_monthly === null ||
    typeof raw.upgrade_price_monthly === "number"
      ? (raw.upgrade_price_monthly as number | null)
      : undefined;
  if (upgradePriceMonthly === undefined) return null;

  return {
    feature: raw.feature as EntitlementFeature,
    currentTier: raw.current_tier as SubscriptionTierName,
    upgradeTo: upgradeTo as SubscriptionTierName | null,
    upgradePriceMonthly,
  };
}

/**
 * Parse a raw response body string into the entitlement payload, or
 * `null` if the string isn't JSON or doesn't match the expected shape.
 * Convenience wrapper for callers that read the body via
 * `await response.text()` (the sync worker pattern, which doesn't
 * commit to `.json()` because non-402 bodies might not be JSON).
 */
export function parseEntitlementDeniedResponseText(
  text: string,
): ApiErrorEntitlementPayload | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  return parseEntitlementDeniedResponseBody(parsed);
}
