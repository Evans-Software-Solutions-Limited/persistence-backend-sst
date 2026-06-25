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

/**
 * The RevenueCat **Stripe-app PUBLIC key** (`strp_…`) — distinct from the v2
 * secret key above. Required by the v1 `/receipts` "track external purchase"
 * call (`X-Platform: stripe`). Safe to hold server-side: validation happens
 * against Stripe via the `fetch_token`; the public key alone grants nothing.
 */
export function getRevenueCatStripePublicKey(): string {
  return getEnv("REVENUECAT_STRIPE_PUBLIC_KEY");
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

/**
 * Bind a Stripe subscription to a chosen App User ID in RevenueCat — the
 * "Track External Purchases" path (M12 §3b). Without this, RevenueCat's
 * auto-tracked Stripe purchases default to keying the customer on the Stripe
 * customer id (`cus_…`), which would NOT merge with the Apple-side entitlement
 * (keyed on the Supabase user id). Posting the Stripe subscription id as
 * `fetch_token` with `app_user_id = <supabase id>` records the purchase
 * against our id so both rails resolve to one customer / one entitlement.
 *
 * v1 `/receipts` is the only endpoint that ingests an external purchase (no v2
 * equivalent). Auth is the Stripe-app PUBLIC key (`strp_…`), NOT the v2 secret.
 * Idempotent: safe to re-post for the same subscription (RevenueCat re-validates
 * against Stripe and upserts the record). Throws on a non-2xx so the caller can
 * log — binding is best-effort (RevenueCat's own Stripe tracking + the
 * `/revenuecat/webhook` re-fetch are the backstops), so a failure must NOT fail
 * the Stripe webhook.
 */
export async function associateStripePurchaseWithRevenueCat(
  stripeSubscriptionId: string,
  appUserId: string,
): Promise<void> {
  const key = getRevenueCatStripePublicKey();
  const res = await fetch("https://api.revenuecat.com/v1/receipts", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Platform": "stripe",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      app_user_id: appUserId,
      fetch_token: stripeSubscriptionId,
    }),
  });
  if (!res.ok) {
    throw new Error(
      `RevenueCat receipts (stripe) failed: ${res.status} ${res.statusText}`,
    );
  }
}
