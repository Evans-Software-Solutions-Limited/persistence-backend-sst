import type { SubscriptionTierName } from "../entitlement/assertEntitlement";

/**
 * FOUNDING-OFFER catalogue (BRIEF D1). Prices are what Brad charges off-app
 * (bank transfer / Stripe Payment Link); `amount_minor` on a grant records what
 * was actually paid and defaults to these. Caps count NON-REVOKED grants per
 * pool — pending (not yet signed up) grants hold a seat too, because the money
 * has been taken.
 */
export type FoundingPool = "consumer" | "coach";

export type FoundingTierName = Extract<
  SubscriptionTierName,
  "premium" | "premium_plus" | "start_up_coach_plus"
>;

export const FOUNDING_OFFERS: Record<
  FoundingTierName,
  { months: number; priceMinor: number; pool: FoundingPool; label: string }
> = {
  premium: { months: 6, priceMinor: 3000, pool: "consumer", label: "Premium" },
  premium_plus: {
    months: 6,
    priceMinor: 5000,
    pool: "consumer",
    label: "Premium+",
  },
  start_up_coach_plus: {
    months: 6,
    priceMinor: 9900,
    pool: "coach",
    label: "Start Up Coach+",
  },
};

export const FOUNDING_POOL_CAPS: Record<FoundingPool, number> = {
  consumer: 200,
  coach: 20,
};

export const FOUNDING_TIER_NAMES = Object.keys(
  FOUNDING_OFFERS,
) as FoundingTierName[];

export function isFoundingTier(name: string): name is FoundingTierName {
  return Object.prototype.hasOwnProperty.call(FOUNDING_OFFERS, name);
}

export function tiersInPool(pool: FoundingPool): FoundingTierName[] {
  return FOUNDING_TIER_NAMES.filter((t) => FOUNDING_OFFERS[t].pool === pool);
}

export const FOUNDING_PAYMENT_METHODS = [
  "bank_transfer",
  "stripe_link",
  "card_in_person",
  "other",
] as const;
export type FoundingPaymentMethod = (typeof FOUNDING_PAYMENT_METHODS)[number];

/** `external_subscription_id` prefix for founding rows (BRIEF D3). */
export const FOUNDING_EXTERNAL_ID_PREFIX = "founding_";

export function foundingExternalId(grantId: string): string {
  return `${FOUNDING_EXTERNAL_ID_PREFIX}${grantId}`;
}

export function addMonths(from: Date, months: number): Date {
  const d = new Date(from.getTime());
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}
