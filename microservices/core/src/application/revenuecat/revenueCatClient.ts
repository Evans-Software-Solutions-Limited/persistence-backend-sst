import { getEnv } from "@persistence/api-utils/env";
import {
  billingCycleFromPeriodMs,
  rcEntitlementToTier,
  TIER_RANK,
  type NormalizedSubscription,
} from "./entitlements";

/**
 * RevenueCat REST v2 client (M12). Server-only — uses the secret API key
 * (`sk_…`), never shipped to the client. Native `fetch` (Lambda Node runtime),
 * no SDK dependency, matching the codebase's outbound-HTTP convention.
 *
 * Field names on the `active_entitlements` response are parsed defensively
 * (RevenueCat's v2 shapes evolve); unknown entitlement ids are dropped so a
 * new RevenueCat entitlement can't crash the sync. Confirm exact field names
 * against the RevenueCat v2 docs at integration time (FRONTEND/BACKEND_BRIEF
 * source caveat).
 */

const RC_API_BASE = "https://api.revenuecat.com/v2";

export function getRevenueCatApiKey(): string {
  return getEnv("REVENUECAT_API_KEY");
}

export function getRevenueCatProjectId(): string {
  return getEnv("REVENUECAT_PROJECT_ID");
}

export function getRevenueCatWebhookSecret(): string {
  return getEnv("REVENUECAT_WEBHOOK_SECRET");
}

/**
 * Raw shape of one `GET /customers/{id}/subscriptions` list item (parsed
 * defensively — confirmed against a real v2 sandbox response 2026-07-22). The
 * human entitlement id we map to a tier is nested at
 * `entitlements.items[].lookup_key`; the top-level `product_id` is a RevenueCat
 * OBJECT id (`prod…`, not the store product id).
 */
interface RawSubscriptionEntitlement {
  lookup_key?: unknown;
}
interface RawCustomerSubscription {
  gives_access?: unknown;
  auto_renewal_status?: unknown;
  current_period_starts_at?: unknown;
  current_period_ends_at?: unknown;
  ends_at?: unknown;
  product_id?: unknown;
  store?: unknown;
  entitlements?: { items?: RawSubscriptionEntitlement[] };
}

interface CustomerSubscriptionsResponse {
  items?: RawCustomerSubscription[];
}

/**
 * Epoch-ms for a RevenueCat timestamp. v2 returns period timestamps as ms
 * numbers, but we reuse `parseRcTimestamp` so an ISO string (should the shape
 * ever change) is tolerated rather than silently dropped to null.
 */
function asEpochMs(raw: unknown): number | null {
  return parseRcTimestamp(raw)?.getTime() ?? null;
}

/**
 * Parse a RevenueCat timestamp. v2 returns epoch milliseconds (number); we also
 * tolerate an ISO string. Returns `null` for missing / unparseable values
 * (treated as "no expiry known" — an active entitlement with no expiry stays
 * active until a later event says otherwise).
 */
export function parseRcTimestamp(raw: unknown): Date | null {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return new Date(raw);
  }
  if (typeof raw === "string" && raw.length > 0) {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/**
 * Normalise one raw subscription; `null` when it grants no access or carries no
 * entitlement we model. Picks the highest-ranked modelled entitlement on the
 * subscription (a sub can list several; the tier is the best one).
 */
export function normalizeSubscription(
  raw: RawCustomerSubscription,
): NormalizedSubscription | null {
  // Guard the item itself, not just its fields: a null/non-object entry in the
  // v2 `items` array would otherwise throw here, bubble through the webhook's
  // catch → markFailed → 500, and RevenueCat would retry the same malformed
  // payload forever. Skip it instead (a payment path must always converge).
  if (typeof raw !== "object" || raw === null) return null;
  if (raw.gives_access !== true) return null;

  const entitlementItems = Array.isArray(raw.entitlements?.items)
    ? raw.entitlements.items
    : [];
  let tier: NormalizedSubscription["tier"] | null = null;
  for (const ent of entitlementItems) {
    if (typeof ent.lookup_key !== "string") continue;
    const mapped = rcEntitlementToTier(ent.lookup_key);
    if (mapped === null) continue;
    if (tier === null || TIER_RANK[mapped] > TIER_RANK[tier]) tier = mapped;
  }
  if (tier === null) return null;

  const startMs = asEpochMs(raw.current_period_starts_at);
  const endMs = asEpochMs(raw.current_period_ends_at) ?? asEpochMs(raw.ends_at);

  return {
    tier,
    expiresAt: endMs === null ? null : new Date(endMs),
    billingCycle: billingCycleFromPeriodMs(startMs, endMs),
    productId: typeof raw.product_id === "string" ? raw.product_id : null,
    store: typeof raw.store === "string" ? raw.store : null,
    autoRenewOff: raw.auto_renewal_status === "will_not_renew",
  };
}

/**
 * Fetch a customer's access-granting subscriptions from RevenueCat v2
 * (`GET /customers/{id}/subscriptions`) and normalise them — tier (from the
 * nested `entitlements.items[].lookup_key`), expiry, product, store and
 * auto-renew, all in one call.
 *
 * Sourced from `/subscriptions` rather than `/active_entitlements` because the
 * latter returns only the entitlement OBJECT id (`entl…`), which we can't map
 * to a tier, and no product/store — the root cause of subscriptions never
 * reaching `user_subscriptions`. It also folds in the former separate
 * `fetchAutoRenewOff` call.
 *
 * Throws on a non-2xx response so the webhook handler marks the event `failed`
 * and RevenueCat retries — a transient outage must NOT be silently treated as
 * "no subscriptions" (which would revoke a paying user's access).
 */
export async function fetchCustomerSubscriptions(
  appUserId: string,
): Promise<NormalizedSubscription[]> {
  const key = getRevenueCatApiKey();
  const projectId = getRevenueCatProjectId();
  const url = `${RC_API_BASE}/projects/${projectId}/customers/${encodeURIComponent(
    appUserId,
  )}/subscriptions`;

  const res = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${key}` },
  });

  if (!res.ok) {
    throw new Error(
      `RevenueCat subscriptions failed: ${res.status} ${res.statusText}`,
    );
  }

  const json = (await res.json()) as CustomerSubscriptionsResponse;
  const items = Array.isArray(json.items) ? json.items : [];
  return items
    .map(normalizeSubscription)
    .filter((s): s is NormalizedSubscription => s !== null);
}
