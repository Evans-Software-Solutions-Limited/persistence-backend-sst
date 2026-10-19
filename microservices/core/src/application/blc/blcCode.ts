import { getEnvOrDefault } from "@persistence/api-utils/env";
import type Stripe from "stripe";
import { getStripe } from "../stripe/stripeClient";

/**
 * Is this a Blue Light Card promotion code we will honour?
 *
 * The discount lives entirely in Stripe: one Coupon (20 % off, forever), and
 * Promotion Codes that point at it — BLC's generic code or a batch of
 * single-use ones. This file's job is to make sure a code presented to the
 * checkout is one of THOSE, and nothing else that happens to exist in the
 * Stripe account. Without that check, any promotion code on any coupon could
 * be pushed through `/blc/checkout` and the "BLC" subscription would carry
 * whatever discount that code grants.
 *
 * ─── One answer for every failure ───
 *
 * Unknown, inactive, expired, wrong coupon and fully redeemed all come back as
 * `null`, and the route says `invalid_code` for all of them. Distinguishing
 * them would let somebody probe which codes exist and which have been used;
 * BLC's member-facing copy covers the "it didn't work" case well enough.
 *
 * ─── Normalisation ───
 *
 * Stripe's `promotionCodes.list({ code })` is case-insensitive, so the only
 * thing done here is trimming whitespace. Dashes and internal spaces are kept
 * exactly as typed: Stripe stores the code as created, and stripping
 * characters here would turn a code that was created WITH a dash into one
 * that never matches. The returned `code` is Stripe's own canonical spelling,
 * which is what goes on the subscription metadata and to Tradedoubler.
 */

export interface BlcPromotionCode {
  /** Stripe Promotion Code id (`promo_…`) — what the Session's `discounts` take. */
  id: string;
  /** The code as Stripe stores it. */
  code: string;
}

/** The coupon every honoured code must belong to. Empty = rail not configured. */
export function blcCouponId(): string {
  return getEnvOrDefault("BLC_STRIPE_COUPON_ID", "").trim();
}

export async function resolveBlcPromotionCode(
  raw: string,
): Promise<BlcPromotionCode | null> {
  const code = raw.trim();
  if (code.length === 0) return null;

  const couponId = blcCouponId();
  if (couponId.length === 0) {
    console.error(
      "[blc:code] refusing — BLC_STRIPE_COUPON_ID is not configured",
    );
    return null;
  }

  // `active: true` filters on the promotion code's own flag; the coupon's
  // validity and the redemption cap are checked below because Stripe does not
  // fold them into that filter.
  const page = await getStripe().promotionCodes.list({
    code,
    active: true,
    limit: 1,
  });
  const promo = page.data[0];
  if (!promo || !promo.active) return null;

  const coupon = readPromotionCoupon(promo);
  if (coupon === null) return null;
  const promoCouponId = typeof coupon === "string" ? coupon : coupon.id;
  if (promoCouponId !== couponId) return null;
  if (typeof coupon !== "string" && !coupon.valid) return null;

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (promo.expires_at !== null && promo.expires_at <= nowSeconds) return null;
  if (
    promo.max_redemptions !== null &&
    promo.times_redeemed >= promo.max_redemptions
  ) {
    return null;
  }

  return { id: promo.id, code: promo.code };
}

/**
 * The coupon behind a promotion code, across API versions. SDK 22 (API
 * 2025-09+) nests it as `promotion.coupon`; earlier versions put it at the
 * top level as `coupon`. The runtime payload follows the account's API
 * version, so both are read — the same defence `_helpers.ts` applies to
 * `current_period_end`.
 */
export function readPromotionCoupon(
  promo: Stripe.PromotionCode,
): string | Stripe.Coupon | null {
  const nested = promo.promotion?.coupon;
  if (nested !== undefined && nested !== null) return nested;
  const legacy = (
    promo as unknown as { coupon?: string | Stripe.Coupon | null }
  ).coupon;
  return legacy ?? null;
}
