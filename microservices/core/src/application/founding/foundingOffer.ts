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
  /** Paid on the website through Stripe Checkout (2026-09-05 amendment). */
  "stripe_checkout",
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

// ─── Web checkout (FOUNDING-OFFER BRIEF § 2, 2026-09-05 amendment) ───────────

/** The terms sold on the website. The coach tier is admin/enquiry only. */
export const FOUNDING_WEB_TIERS = ["premium", "premium_plus"] as const;
export type FoundingWebTier = (typeof FOUNDING_WEB_TIERS)[number];

export const FOUNDING_WEB_MONTHS = [6, 12] as const;
export type FoundingWebMonths = (typeof FOUNDING_WEB_MONTHS)[number];

export function isFoundingWebTier(value: string): value is FoundingWebTier {
  return (FOUNDING_WEB_TIERS as readonly string[]).includes(value);
}

export function isFoundingWebMonths(value: number): value is FoundingWebMonths {
  return (FOUNDING_WEB_MONTHS as readonly number[]).includes(value);
}

/**
 * The moment the offer closes: 30 September 2026, 23:59:59 British Summer
 * Time. After it the plan buttons and the checkout route refuse.
 *
 * An absolute instant with an explicit offset rather than a local date, so the
 * cut-off is the same for a buyer in Sydney as for one in Nottingham and does
 * not move with the server's timezone.
 */
export const FOUNDING_OFFER_CLOSES = new Date("2026-09-30T23:59:59+01:00");

export function foundingOfferIsOpen(now: Date = new Date()): boolean {
  return now.getTime() <= FOUNDING_OFFER_CLOSES.getTime();
}

/**
 * How long a Checkout Session — and therefore its pool-seat hold — lives.
 * Stripe's own minimum is 30 minutes, and matching it exactly means the local
 * hold and the Session expire together rather than one outliving the other.
 */
export const FOUNDING_CHECKOUT_TTL_MS = 30 * 60 * 1000;

/**
 * The actor recorded on a grant and its audit rows when the WEBHOOK creates
 * them — nobody in `/admin` did, so no administrator's id belongs there.
 *
 * The nil UUID, deliberately: `granted_by` and `admin_audit_log.actor_id` are
 * `uuid NOT NULL` with no foreign key (they are immutable issuer records that
 * outlive a deleted administrator), so a sentinel is both storable and
 * unmistakable. Anything that renders an actor should read this as "the system".
 */
export const FOUNDING_WEB_ACTOR_ID = "00000000-0000-0000-0000-000000000000";

/**
 * Stripe **lookup keys** for the four web terms, and the amount each must
 * charge.
 *
 * Lookup keys rather than Price ids, and a constant rather than configuration,
 * because a lookup key is identical in test and live mode. That leaves
 * `STRIPE_SECRET_KEY` as the only thing that differs per environment — nothing
 * to set per stage, nothing to set WRONG per stage, and no way for staging to
 * point at a live Price by a copy-paste slip.
 *
 * `amountMinor` is not what gets charged: Stripe's Price is. It is here to be
 * CHECKED against, so a dashboard edit that changes a price cannot silently
 * change what this page sells — see `resolveFoundingPrices`.
 */
export const FOUNDING_PRICE_LOOKUP_KEYS: Record<
  FoundingWebTier,
  Record<FoundingWebMonths, { lookupKey: string; amountMinor: number }>
> = {
  premium: {
    6: { lookupKey: "founding_premium_6m", amountMinor: 3000 },
    12: { lookupKey: "founding_premium_12m", amountMinor: 6000 },
  },
  premium_plus: {
    6: { lookupKey: "founding_premium_plus_6m", amountMinor: 5000 },
    12: { lookupKey: "founding_premium_plus_12m", amountMinor: 10000 },
  },
};

/** Every lookup key, for the single list call that resolves them all. */
export const ALL_FOUNDING_LOOKUP_KEYS: string[] = Object.values(
  FOUNDING_PRICE_LOOKUP_KEYS,
).flatMap((byTerm) => Object.values(byTerm).map((entry) => entry.lookupKey));

/** The currency every founding Price must be denominated in. */
export const FOUNDING_PRICE_CURRENCY = "gbp";

/**
 * Marks a `founding_checkout_sessions` row that holds a seat but has no Stripe
 * Session yet. Never matches a real `cs_…` id, so a webhook can never land on
 * an unbound reservation.
 *
 * Lives here rather than beside the repository that writes it: the route reads
 * it too, and a test that mocks the repository module wholesale would
 * otherwise leave the route comparing against `undefined`.
 */
export const RESERVATION_PREFIX = "reserved_";
