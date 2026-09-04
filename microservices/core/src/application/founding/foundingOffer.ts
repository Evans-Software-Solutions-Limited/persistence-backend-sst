import { utc } from "@date-fns/utc";
import { addMonths as addCalendarMonths } from "date-fns";

import type { SubscriptionTierName } from "../entitlement/assertEntitlement";

/**
 * Founding tier catalogue. Access duration is chosen per administrative grant;
 * these values are UI defaults only. Pool caps live in
 * `founding_pool_limits`; only non-revoked `founding` grants consume them.
 */
export type FoundingPool = "consumer" | "coach";

export type FoundingTierName = Extract<
  SubscriptionTierName,
  "premium" | "premium_plus" | "start_up_coach_plus"
>;

export const FOUNDING_OFFERS: Record<
  FoundingTierName,
  { months: number; pool: FoundingPool; label: string }
> = {
  premium: { months: 6, pool: "consumer", label: "Premium" },
  premium_plus: {
    months: 6,
    pool: "consumer",
    label: "Premium+",
  },
  start_up_coach_plus: {
    months: 6,
    pool: "coach",
    label: "Start Up Coach+",
  },
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
  return new Date(addCalendarMonths(from, months, { in: utc }).getTime());
}
