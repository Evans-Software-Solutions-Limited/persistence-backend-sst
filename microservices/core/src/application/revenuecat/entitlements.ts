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
const TIER_RANK: Record<SubscriptionTierName, number> = {
  free: 0,
  premium: 1,
  individual_trainer: 2,
  small_business: 3,
  medium_enterprise: 4,
};

/**
 * A RevenueCat active entitlement, normalised from the REST v2
 * `active_entitlements` response into the fields the sync cares about.
 */
export interface NormalizedEntitlement {
  tier: SubscriptionTierName;
  expiresAt: Date | null;
  productId: string | null;
  store: string | null;
}

/**
 * The desired `user_subscriptions` state derived from a customer's active
 * entitlements. `null` means "no active entitlement → revert to free".
 */
export interface DesiredSubscription {
  tier: SubscriptionTierName;
  expiresAt: Date | null;
  billingCycle: "monthly" | "yearly";
  productId: string | null;
  store: string | null;
}

/**
 * Derive a billing cycle from a RevenueCat product identifier. RevenueCat
 * doesn't expose the period directly on the entitlement, but our product ids
 * encode it (e.g. `..._annual`, `..._yearly`). Defaults to monthly when the id
 * is absent or doesn't signal a yearly term.
 */
export function billingCycleFromProductId(
  productId: string | null,
): "monthly" | "yearly" {
  if (productId === null) return "monthly";
  const lower = productId.toLowerCase();
  if (lower.includes("annual") || lower.includes("year")) return "yearly";
  return "monthly";
}

/**
 * Pick the single subscription state to write from a customer's active
 * entitlements. Highest-ranked tier wins; `null` when there are none (the
 * customer has reverted to free and any live mirror row should be cancelled).
 */
export function pickDesiredSubscription(
  entitlements: NormalizedEntitlement[],
): DesiredSubscription | null {
  let best: NormalizedEntitlement | null = null;
  for (const ent of entitlements) {
    if (best === null || TIER_RANK[ent.tier] > TIER_RANK[best.tier]) {
      best = ent;
    }
  }
  if (best === null) return null;
  return {
    tier: best.tier,
    expiresAt: best.expiresAt,
    billingCycle: billingCycleFromProductId(best.productId),
    productId: best.productId,
    store: best.store,
  };
}
