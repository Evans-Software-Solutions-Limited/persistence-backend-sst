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
 * Known product ids (12 packages, all in the `default` offering) — spec-29
 * Phase 2 coach ladder, every tier now monthly + annual:
 *   - `app.persistence.premium.{monthly,annual}`
 *   - `app.persistence.premium_plus.{monthly,annual}` (M19-P0)
 *   - `app.persistence.trainer.individual.{monthly,annual}`   (Start Up Coach)
 *   - `app.persistence.start_up_coach_plus.{monthly,annual}`
 *   - `app.persistence.coach.{monthly,annual}`
 *   - `app.persistence.coach_pro.{monthly,annual}`
 *
 * The retired `small_business` / `medium_enterprise` products are detached in
 * RevenueCat; anything unrecognised maps to `tier: null` and is filtered out of
 * the paywall.
 */

/**
 * Derive the billing cycle from a store product identifier. Mirrors the
 * backend's `billingCycleFromProductId` so both rails agree. Defaults to
 * monthly when the id doesn't signal a yearly term.
 *
 * ⚠ Total-but-lax: this silently defaults to `monthly`, so it will render an
 * unrecognised yearly Play base plan (e.g. `p1y`) as monthly. `toPurchaseProduct`
 * and any paywall path MUST use the strict `billingCycleFromStoreProductId`
 * below instead. Retained only for callers that genuinely need a total function;
 * do NOT reach for this by name.
 */
export function billingCycleFromProductId(productId: string): BillingCycle {
  const lower = productId.toLowerCase();
  if (lower.includes("annual") || lower.includes("year")) return "yearly";
  return "monthly";
}

/**
 * Split a store product identifier into its subscription id and optional base
 * plan id. Google Play exposes the RevenueCat-selected option as
 * `subscriptionId:basePlanId` (`app.persistence.premium:annual`); Apple ids
 * carry the cadence inline with no `:` (`app.persistence.premium.monthly`), so
 * `basePlanId` is `null` there. This is the ONLY store-product-id parser in the
 * mobile layer — the adapter reuses it rather than re-splitting on `:`.
 */
export function parseStoreProductId(id: string): {
  subscriptionId: string;
  basePlanId: string | null;
} {
  const separator = id.indexOf(":");
  if (separator === -1) return { subscriptionId: id, basePlanId: null };
  const basePlanId = id.slice(separator + 1);
  return {
    subscriptionId: id.slice(0, separator),
    basePlanId: basePlanId.length > 0 ? basePlanId : null,
  };
}

/**
 * Classify a single cadence token (a base plan id, or a whole product id) into a
 * `BillingCycle`, or `null` when it carries no recognisable cadence signal.
 *
 * Recognises both the word forms Apple/our-convention use (`annual` / `year` /
 * `month`) and the ISO-8601 period tokens Google Play generates for auto-named
 * base plans. `BillingCycle` has only `monthly` / `yearly`, so ONLY the unit-1
 * periods map onto it: `p1y` → yearly, `p1m` → monthly. A multi-unit period
 * (`p3m`, `p6m`, `p2y`, …) has NO `BillingCycle` representation and returns
 * `null` — the caller then DROPS the package rather than mislabel a
 * quarterly/biannual price as "monthly", which is the pricing-misrepresentation
 * class behind the current App Store Guideline 3.0.0 rejection. We ship only
 * monthly + annual base plans, so no live product hits the null path today.
 */
function cycleFromCadenceToken(value: string): BillingCycle | null {
  const lower = value.toLowerCase();
  if (lower.includes("annual") || lower.includes("year")) return "yearly";
  if (lower.includes("month")) return "monthly";
  const isoPeriod = /(?:^|[^a-z0-9])p(\d+)([ym])(?![a-z])/.exec(lower);
  if (isoPeriod !== null && isoPeriod[1] === "1") {
    return isoPeriod[2] === "y" ? "yearly" : "monthly";
  }
  return null;
}

/**
 * Strict cadence classifier — the variant `toPurchaseProduct` uses. Derives the
 * billing cycle from a store product identifier, returning `null` when the
 * cadence genuinely can't be determined rather than defaulting to monthly.
 * Classifies from the base plan id first (Play's `subscriptionId:basePlanId`),
 * then falls back to the whole identifier.
 *
 * Callers must DROP a `null`-cadence package from the paywall — mirroring
 * `offeringTrialDays`: never advertise a term we can't verify. A Play base plan
 * auto-named `p1y` must render as yearly, not silently as the monthly default —
 * the same class of defect behind the current App Store Guideline 3.0.0
 * rejection. The total `billingCycleFromProductId` above is retained unchanged
 * for callers that need a total function.
 *
 * ⚠ Play Console naming contract: every base plan MUST be named with a
 * recognised cadence token (`monthly` / `annual`, or `p1m` / `p1y`). A base
 * plan named otherwise (e.g. `1yr`, `standard`) classifies to `null` and its
 * tile is dropped from the Android paywall — unbuyable, not merely
 * mis-labelled. Our twelve live base plans use `:monthly` / `:annual`, so this
 * holds; re-confirm it whenever a base plan is added or renamed in Play
 * Console.
 */
export function billingCycleFromStoreProductId(
  id: string,
): BillingCycle | null {
  const { basePlanId } = parseStoreProductId(id);
  if (basePlanId !== null) {
    const fromBasePlan = cycleFromCadenceToken(basePlanId);
    if (fromBasePlan !== null) return fromBasePlan;
  }
  return cycleFromCadenceToken(id);
}

/**
 * Map a store product identifier to a `SubscriptionTierName`. `null` for an id we
 * don't model.
 *
 * ⚠ ORDER-SENSITIVE substring ladder — longer names first. Every coach product id
 * (`coach_pro`, `start_up_coach_plus`) contains the substring `coach`, so the
 * plain `coach` test MUST come last of the three; likewise `premium_plus` must
 * precede `premium`. Testing a shorter name first would misclassify the purchase
 * and grant the wrong entitlement (spec-29 § 5.5; the M19-P0 premium/premium_plus
 * bug is the precedent). `individual` / `trainer` matches Start Up Coach, whose id
 * lives under the `trainer.individual` namespace and contains no `coach`.
 */
export function tierFromProductId(
  productId: string,
): SubscriptionTierName | null {
  const lower = productId.toLowerCase();
  if (lower.includes("coach_pro")) {
    return "coach_pro";
  }
  if (lower.includes("start_up_coach_plus")) {
    return "start_up_coach_plus";
  }
  if (lower.includes("coach")) {
    return "coach";
  }
  if (lower.includes("premium_plus")) {
    return "premium_plus";
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

/**
 * The intro-offer shape we care about, mirrored structurally from RevenueCat's
 * `PurchasesStoreProduct.introPrice` so this stays a pure, RN-free function.
 */
export interface IntroOffer {
  /** Intro-offer price in the store currency; `0` marks a free trial. */
  price: number;
  /** `"DAY" | "WEEK" | "MONTH" | "YEAR"` (others → not a trial we advertise). */
  periodUnit: string;
  periodNumberOfUnits: number;
}

/**
 * Convert a product's introductory offer into whole trial days — but ONLY when
 * it's a FREE trial (zero price). A paid intro offer, an absent offer, or an
 * unrecognised period unit returns `null` so callers render NO trial banner.
 * Keeps app copy tied to what Apple actually grants rather than a guess.
 */
export function freeTrialDaysFromIntroOffer(
  introOffer: IntroOffer | null | undefined,
): number | null {
  if (!introOffer || introOffer.price !== 0) return null;
  const n = introOffer.periodNumberOfUnits;
  if (!Number.isFinite(n) || n <= 0) return null;
  switch (introOffer.periodUnit) {
    case "DAY":
      return n;
    case "WEEK":
      return n * 7;
    case "MONTH":
      return n * 30;
    case "YEAR":
      return n * 365;
    default:
      return null;
  }
}

type GooglePlaySubscriptionOption = {
  readonly freePhase?: {
    readonly billingPeriod: {
      readonly unit: string;
      readonly value: number;
    };
    readonly price: { readonly amountMicros: number };
  } | null;
} | null;

/**
 * Derive the free-trial duration selected by Google Play for this customer.
 * RevenueCat's explicit intro-eligibility API is iOS-only; on Android its
 * `defaultOption` already reflects the eligible base-plan/offer and exposes a
 * zero-priced `freePhase` when a trial can be presented.
 */
export function freeTrialDaysFromGooglePlayOption(
  option: GooglePlaySubscriptionOption | undefined,
): number | null {
  const phase = option?.freePhase;
  if (!phase || phase.price.amountMicros !== 0) return null;
  const n = phase.billingPeriod.value;
  if (!Number.isFinite(n) || n <= 0) return null;
  switch (phase.billingPeriod.unit) {
    case "DAY":
      return n;
    case "WEEK":
      return n * 7;
    case "MONTH":
      return n * 30;
    case "YEAR":
      return n * 365;
    default:
      return null;
  }
}

/**
 * The free-trial length (days) to advertise for an offering: the first package
 * carrying a free-trial intro offer wins, else `null`. All products share the
 * same intro offer in practice, so one value is correct for every card.
 *
 * Returns `null` — NOT a hardcoded fallback — when no package surfaces a real
 * offer (App Store Connect offer missing/unapproved, or not yet synced by
 * RevenueCat). Callers must render NO trial banner in that case: advertising a
 * guessed duration risks promising the user something Apple won't grant.
 */
export function offeringTrialDays(packages: PurchaseProduct[]): number | null {
  for (const pkg of packages) {
    if (pkg.introTrialDays != null && pkg.introTrialDays > 0) {
      return pkg.introTrialDays;
    }
  }
  return null;
}
