import { getEnv } from "@persistence/api-utils/env";
import {
  rcEntitlementToTier,
  type NormalizedEntitlement,
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

/** Raw shape of one `active_entitlements` list item (parsed defensively). */
interface RawActiveEntitlement {
  entitlement_id?: unknown;
  expires_at?: unknown;
  product_identifier?: unknown;
  store?: unknown;
}

interface ActiveEntitlementsResponse {
  items?: RawActiveEntitlement[];
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

/** Normalise one raw entitlement; `null` when the id is missing/unmodelled. */
export function normalizeEntitlement(
  raw: RawActiveEntitlement,
): NormalizedEntitlement | null {
  if (typeof raw.entitlement_id !== "string") return null;
  const tier = rcEntitlementToTier(raw.entitlement_id);
  if (tier === null) return null;
  return {
    tier,
    expiresAt: parseRcTimestamp(raw.expires_at),
    productId:
      typeof raw.product_identifier === "string"
        ? raw.product_identifier
        : null,
    store: typeof raw.store === "string" ? raw.store : null,
  };
}

/**
 * Fetch a customer's active entitlements from RevenueCat. Throws on a non-2xx
 * response so the webhook handler marks the event `failed` and RevenueCat
 * retries — a transient RevenueCat outage must NOT be silently treated as
 * "no entitlements" (which would revoke a paying user's access).
 */
export async function fetchActiveEntitlements(
  appUserId: string,
): Promise<NormalizedEntitlement[]> {
  const key = getRevenueCatApiKey();
  const projectId = getRevenueCatProjectId();
  const url = `${RC_API_BASE}/projects/${projectId}/customers/${encodeURIComponent(
    appUserId,
  )}/active_entitlements`;

  const res = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${key}` },
  });

  if (!res.ok) {
    throw new Error(
      `RevenueCat active_entitlements failed: ${res.status} ${res.statusText}`,
    );
  }

  const json = (await res.json()) as ActiveEntitlementsResponse;
  const items = Array.isArray(json.items) ? json.items : [];
  return items
    .map(normalizeEntitlement)
    .filter((e): e is NormalizedEntitlement => e !== null);
}

/** Raw shape of one `subscriptions` list item (parsed defensively). */
interface RawSubscription {
  auto_renewal_status?: unknown;
  gives_access?: unknown;
}

interface SubscriptionsResponse {
  items?: RawSubscription[];
}

/**
 * Whether the customer has turned OFF auto-renew on a subscription that still
 * grants access — i.e. "cancelled but active" (in the paid period, won't
 * renew). Drives the in-app "cancelled — active until X" banner on the iOS
 * rail (Apple owns the cancel UX; the app only reflects it).
 *
 * Reads RevenueCat v2 `GET /customers/{id}/subscriptions` and looks for an
 * access-granting item whose `auto_renewal_status` is `will_not_renew` (the
 * field RevenueCat provides specifically so integrators don't have to derive
 * cancellation from `unsubscribe_detected_at`).
 *
 * FAIL-SAFE + COSMETIC: this only toggles a display flag — access is decided
 * elsewhere (active entitlement + expiry). Any error, a non-2xx, or an
 * unexpected shape resolves to `false` (banner simply doesn't show — the prior
 * behaviour), so a subscriptions-endpoint hiccup can never fail the webhook or
 * revoke access. The exact `auto_renewal_status` / `gives_access` field
 * spellings are doc-derived; confirm against a real sandbox response at the
 * 12.11 IAP sign-off (a wrong spelling just leaves the banner hidden).
 */
export async function fetchAutoRenewOff(appUserId: string): Promise<boolean> {
  try {
    const key = getRevenueCatApiKey();
    const projectId = getRevenueCatProjectId();
    const url = `${RC_API_BASE}/projects/${projectId}/customers/${encodeURIComponent(
      appUserId,
    )}/subscriptions`;

    const res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!res.ok) return false;

    const json = (await res.json()) as SubscriptionsResponse;
    const items = Array.isArray(json.items) ? json.items : [];
    return items.some(
      (item) =>
        item.gives_access === true &&
        item.auto_renewal_status === "will_not_renew",
    );
  } catch {
    return false;
  }
}
