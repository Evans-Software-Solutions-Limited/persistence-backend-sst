/**
 * The Blue Light Card (BLC) member offer — the ONE web subscription rail.
 *
 * Persistence sells Premium / Premium+ through Apple and Google IAP. For the
 * BLC partnership a buyer gets 20 % off either tier, monthly or annual, bought
 * on the marketing site through Stripe Checkout and used in the app. The app
 * never promotes or links to it (App Store Guideline 3.1.3(b)); the site does.
 *
 * ─── What Stripe owns, and what this file owns ───
 *
 * Stripe owns the PRICE and the DISCOUNT. The four Prices here are the FULL
 * public amounts; the 20 % comes off through one Coupon (`duration: forever`)
 * attached to Promotion Codes — BLC's generic code, or single-use codes. The
 * server verifies the code belongs to THAT coupon before building a Session
 * (`blcCode.ts`), so the member price can never be obtained without a code,
 * and redemption caps and expiry are Stripe's to enforce.
 *
 * This file owns the CATALOGUE: which tiers and cadences are sold, under which
 * lookup keys, at which advertised amount. `blcPrices.ts` refuses any Price
 * whose amount drifts from the figure here, for the same reason the founding
 * rail does — a lookup key re-pointed in the dashboard must not silently
 * change what the page charges.
 */

export const BLC_TIERS = ["premium", "premium_plus"] as const;
export type BlcTier = (typeof BLC_TIERS)[number];

export const BLC_CADENCES = ["monthly", "annual"] as const;
export type BlcCadence = (typeof BLC_CADENCES)[number];

export function isBlcTier(value: string): value is BlcTier {
  return (BLC_TIERS as readonly string[]).includes(value);
}

export function isBlcCadence(value: string): value is BlcCadence {
  return (BLC_CADENCES as readonly string[]).includes(value);
}

/** `channel` stamped on every Session and subscription this rail creates. */
export const BLC_CHANNEL = "blc";

export const BLC_PRICE_CURRENCY = "gbp";

/**
 * Full public prices, in minor units (pence). The coupon applies the 20 %.
 * Stripe's `recurring.interval` for each cadence is verified alongside the
 * amount so a monthly key cannot be re-pointed at an annual Price.
 */
export const BLC_PRICE_LOOKUP_KEYS: Record<
  BlcTier,
  Record<
    BlcCadence,
    { lookupKey: string; amountMinor: number; interval: "month" | "year" }
  >
> = {
  premium: {
    monthly: {
      lookupKey: "web_premium_monthly",
      amountMinor: 1699,
      interval: "month",
    },
    annual: {
      lookupKey: "web_premium_annual",
      amountMinor: 13999,
      interval: "year",
    },
  },
  premium_plus: {
    monthly: {
      lookupKey: "web_premium_plus_monthly",
      amountMinor: 2999,
      interval: "month",
    },
    annual: {
      lookupKey: "web_premium_plus_annual",
      amountMinor: 24999,
      interval: "year",
    },
  },
};

export const ALL_BLC_LOOKUP_KEYS: string[] = BLC_TIERS.flatMap((tier) =>
  BLC_CADENCES.map((cadence) => BLC_PRICE_LOOKUP_KEYS[tier][cadence].lookupKey),
);

/**
 * `user_subscriptions.billing_cycle` accepts `monthly` | `yearly`
 * (`normaliseBillingCycle` in `subscriptionRepository.ts` maps anything else
 * to `null`). The web sells "annual"; the row stores "yearly".
 */
export function blcBillingCycle(cadence: BlcCadence): "monthly" | "yearly" {
  return cadence === "annual" ? "yearly" : "monthly";
}

/** How long a Checkout Session stays payable. Stripe's minimum is 30 minutes. */
export const BLC_CHECKOUT_TTL_MS = 30 * 60 * 1000;

/**
 * Consumer-facing terms text Stripe shows on the Checkout page. This is the
 * sentence the buyer TICKS, so it is the one that forms the contract; the
 * marketing page's own terms note must say the same thing.
 */
export const BLC_CHECKOUT_TERMS =
  "I agree to the Persistence terms. My Blue Light Card member price continues while the partnership runs, I can cancel any time, and I can get a full refund within 14 days unless I've started using the app.";
