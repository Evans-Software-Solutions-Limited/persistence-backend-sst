import type { SubscriptionTierName } from "../entitlement/assertEntitlement";

/**
 * RevenueCat entitlement-id ↔ tier mapping (M12).
 *
 * RevenueCat's "Entitlement" is a level of access keyed by an arbitrary string
 * id; we configure one entitlement per paid tier in the RevenueCat dashboard,
 * named identically to our `SubscriptionTierName`. Products from BOTH stores
 * (Apple IAP + Stripe) attach to the same entitlement, so the backend never
 * has to care which rail a purchase came through — it reads the active
 * entitlement and maps it to a tier here.
 *
 * `free` is intentionally NOT an entitlement — the absence of any active
 * entitlement IS the free tier.
 */
export const RC_ENTITLEMENT_IDS = [
  "premium",
  "individual_trainer",
  "small_business",
  "medium_enterprise",
] as const;

/**
 * Map a RevenueCat entitlement id to a `SubscriptionTierName`. Returns `null`
 * for an unrecognised id so the caller can ignore entitlements we don't model
 * (forward-compatible: a new RevenueCat entitlement won't crash the sync).
 */
export function rcEntitlementToTier(
  entitlementId: string,
): SubscriptionTierName | null {
  switch (entitlementId) {
    case "premium":
    case "individual_trainer":
    case "small_business":
    case "medium_enterprise":
      return entitlementId;
    default:
      return null;
  }
}

/**
 * Tier precedence for the (rare) case where a customer has more than one
 * active entitlement — we resolve to the highest-ranked one so the user is
 * never under-served. Free is the floor.
 */
export const TIER_RANK: Record<SubscriptionTierName, number> = {
  free: 0,
  premium: 1,
  individual_trainer: 2,
  small_business: 3,
  medium_enterprise: 4,
};

/**
 * A RevenueCat customer subscription, normalised from the REST v2
 * `GET /customers/{id}/subscriptions` response into the fields the sync cares
 * about. We source from `/subscriptions` (not `/active_entitlements`) because
 * the latter returns only the entitlement OBJECT id (`entl…`) — not the human
 * `lookup_key` we map to a tier — and carries no product/store, whereas each
 * subscription nests `entitlements.items[].lookup_key` plus product, store,
 * period and auto-renew in a single call the read-scoped API key can access.
 */
export interface NormalizedSubscription {
  tier: SubscriptionTierName;
  expiresAt: Date | null;
  billingCycle: "monthly" | "yearly";
  productId: string | null;
  store: string | null;
  /** `auto_renewal_status === "will_not_renew"` → cancelled-but-active. */
  autoRenewOff: boolean;
}

/**
 * The desired `user_subscriptions` state derived from a customer's
 * access-granting subscriptions. `null` means "no access → revert to free".
 */
export interface DesiredSubscription {
  tier: SubscriptionTierName;
  expiresAt: Date | null;
  billingCycle: "monthly" | "yearly";
  productId: string | null;
  store: string | null;
  autoRenewOff: boolean;
}

/** ~half a year in ms — the monthly/yearly split point for the period heuristic. */
const YEARLY_PERIOD_THRESHOLD_MS = 180 * 24 * 60 * 60 * 1000;

/**
 * Derive the billing cycle from a subscription's current-period span. The v2
 * subscription object exposes no period-unit field and its `product_id` is a
 * RevenueCat OBJECT id (`prod…`, not the store id that would encode the term),
 * so we infer from the period length: a span over ~6 months is yearly, else
 * monthly. Best-effort + display-only (access is decided by tier + expiry).
 * NOTE: during a free trial the current period is the trial length (and in the
 * App Store sandbox all periods are heavily compressed), so this can read
 * "monthly" for a yearly plan mid-trial — acceptable for a cosmetic field.
 */
export function billingCycleFromPeriodMs(
  startMs: number | null,
  endMs: number | null,
): "monthly" | "yearly" {
  if (startMs === null || endMs === null) return "monthly";
  return endMs - startMs > YEARLY_PERIOD_THRESHOLD_MS ? "yearly" : "monthly";
}

/**
 * Pick the single subscription state to write from a customer's access-granting
 * subscriptions. Highest-ranked tier wins; ties broken by the latest expiry (a
 * customer may hold several — e.g. repeated sandbox purchases of the same tier
 * — and we mirror the one that keeps access longest). `null` when there are
 * none (the customer has reverted to free and any live mirror should cancel).
 */
export function pickDesiredSubscription(
  subscriptions: NormalizedSubscription[],
): DesiredSubscription | null {
  let best: NormalizedSubscription | null = null;
  for (const sub of subscriptions) {
    if (best === null) {
      best = sub;
      continue;
    }
    const rankDelta = TIER_RANK[sub.tier] - TIER_RANK[best.tier];
    if (rankDelta > 0) {
      best = sub;
    } else if (rankDelta === 0) {
      // Same tier → keep the one expiring latest (missing expiry sorts lowest).
      const bestMs = best.expiresAt?.getTime() ?? -Infinity;
      const subMs = sub.expiresAt?.getTime() ?? -Infinity;
      if (subMs > bestMs) best = sub;
    }
  }
  if (best === null) return null;
  return {
    tier: best.tier,
    expiresAt: best.expiresAt,
    billingCycle: best.billingCycle,
    productId: best.productId,
    store: best.store,
    autoRenewOff: best.autoRenewOff,
  };
}
