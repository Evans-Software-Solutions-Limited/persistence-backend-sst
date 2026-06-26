import type {
  BillingCycle,
  SubscriptionTierName,
} from "@/domain/models/subscription";
import type { PurchaseProduct } from "@/domain/ports/purchases.port";

/**
 * Pure mapping between RevenueCat store products and our domain tiers (M12,
 * iOS rail).
 *
 * Spec: specs/milestones/M12-app-store-iap/FRONTEND_BRIEF.md
 *       specs/milestones/M12-app-store-iap/BRIEF.md § Tier ↔ entitlement table
 *
 * RevenueCat packages don't carry our `SubscriptionTierName` directly, so we
 * derive it from the **store product identifier** by convention — the same
 * approach the backend takes (`revenuecat/entitlements.ts`
 * `billingCycleFromProductId`). The product-id naming below is the contract;
 * it MUST match the ids configured in App Store Connect + attached in the
 * RevenueCat dashboard.
 *
 * Known consumer ids (Part D):
 *   - `app.persistence.premium.{monthly,annual}`
 *   - `app.persistence.trainer.individual.{monthly,annual}`
 *
 * Business tiers (`small_business`, `medium_enterprise`) get Apple products
 * later (cowork is adding them); the keyword matching below already maps them
 * the moment their products follow the same convention — no code change
 * needed. Anything unrecognised maps to `tier: null` and is filtered out of
 * the paywall.
 */

/**
 * Derive the billing cycle from a store product identifier. Mirrors the
 * backend's `billingCycleFromProductId` so both rails agree. Defaults to
 * monthly when the id doesn't signal a yearly term.
 */
export function billingCycleFromProductId(productId: string): BillingCycle {
  const lower = productId.toLowerCase();
  if (lower.includes("annual") || lower.includes("year")) return "yearly";
  return "monthly";
}

/**
 * Map a store product identifier to a `SubscriptionTierName`. `null` for an
 * id we don't model. Most-specific keywords are checked first so the business
 * tiers (which may live under a `trainer.*` namespace) don't get swallowed by
 * the broader `individual` / `trainer` match.
 */
export function tierFromProductId(
  productId: string,
): SubscriptionTierName | null {
  const lower = productId.toLowerCase();
  if (lower.includes("medium_enterprise") || lower.includes("enterprise")) {
    return "medium_enterprise";
  }
  if (lower.includes("small_business") || lower.includes("business")) {
    return "small_business";
  }
  if (lower.includes("premium")) {
    return "premium";
  }
  if (lower.includes("individual") || lower.includes("trainer")) {
    return "individual_trainer";
  }
  return null;
}

/**
 * Find the purchasable package for a given tier + billing cycle. Returns the
 * first match (RevenueCat offerings shouldn't contain duplicate tier/cycle
 * pairs); `null` when no Apple product is configured for that combination —
 * the caller surfaces an "not available on this plan" affordance rather than
 * mounting a £0 purchase sheet.
 */
export function findPackageForTier(
  packages: PurchaseProduct[],
  tier: SubscriptionTierName,
  billingCycle: BillingCycle,
): PurchaseProduct | null {
  return (
    packages.find(
      (pkg) => pkg.tier === tier && pkg.billingCycle === billingCycle,
    ) ?? null
  );
}

/**
 * The set of tier names that have at least one purchasable Apple product in
 * the supplied packages (any billing cycle). Drives which tiles on the iOS
 * paywall are buyable vs. show a "coming soon to iOS" / web affordance.
 */
export function purchasableTiers(
  packages: PurchaseProduct[],
): ReadonlySet<SubscriptionTierName> {
  const tiers = new Set<SubscriptionTierName>();
  for (const pkg of packages) {
    if (pkg.tier !== null) tiers.add(pkg.tier);
  }
  return tiers;
}
