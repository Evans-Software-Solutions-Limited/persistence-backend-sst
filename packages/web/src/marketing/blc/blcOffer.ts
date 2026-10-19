/**
 * The Blue Light Card member offer as the WEBSITE presents it (PER-3).
 *
 * Everything here is DATA for the `/blue-light-card` page: the two tiers, the
 * public and member prices per cadence, the copy, and the Meta content ids.
 * The page and presenter hold no copy of their own, so a wording change is an
 * edit here and nothing else.
 *
 * ⚠ The prices are for DISPLAY. Stripe's Price object decides what a buyer is
 * actually charged — the server builds the Checkout Session from a Price id
 * and never reads a figure from here. If the two disagree, Stripe is right
 * and this file is the bug.
 */

import { catalogTier } from "@persistence/subscription-catalog";

export type BlcTier = "premium" | "premium_plus";
export type BlcCadence = "monthly" | "annual";

export interface BlcPrice {
  /** The public price, in minor units — shown struck through. */
  publicMinor: number;
  /** The member price (20 % off), in minor units. */
  memberMinor: number;
}

/** 20 % off Premium and Premium+, both cadences. */
export const BLC_OFFER: Record<BlcTier, Record<BlcCadence, BlcPrice>> = {
  premium: {
    monthly: { publicMinor: 1699, memberMinor: 1359 },
    annual: { publicMinor: 13999, memberMinor: 11199 },
  },
  premium_plus: {
    monthly: { publicMinor: 2999, memberMinor: 2399 },
    annual: { publicMinor: 24999, memberMinor: 19999 },
  },
};

export const BLC_TIERS: readonly BlcTier[] = ["premium", "premium_plus"];

/** The order the cadence toggle offers them; annual is the default. */
export const BLC_CADENCES: readonly BlcCadence[] = ["monthly", "annual"];

export function isBlcTier(value: unknown): value is BlcTier {
  return value === "premium" || value === "premium_plus";
}

export function isBlcCadence(value: unknown): value is BlcCadence {
  return value === "monthly" || value === "annual";
}

/** Display name + features come from the shared catalog, never retyped. */
export function blcTierName(tier: BlcTier): string {
  return catalogTier(tier).name;
}

export function blcTierFeatures(tier: BlcTier): readonly string[] {
  return catalogTier(tier).features;
}

/**
 * The four member plans as ONE canonical product id each, for Meta's standard
 * commerce parameters on `InitiateCheckout` / `Purchase` — the same role
 * `FoundingPlanId` plays for the founding offer, kept separate so the founding
 * parity test and the server's founding table are untouched.
 *
 * Deliberately loose in its inputs: the thanks page reads `tier`/`cadence`
 * off the status endpoint as plain strings. `undefined` means "send
 * value/currency alone" — never a guessed id.
 */
export type BlcPlanId =
  | "blc_premium_monthly"
  | "blc_premium_annual"
  | "blc_premium_plus_monthly"
  | "blc_premium_plus_annual";

export function blcPlanContentId(
  tier: string | undefined,
  cadence: string | undefined,
): BlcPlanId | undefined {
  if (!isBlcTier(tier) || !isBlcCadence(cadence)) return undefined;
  return `blc_${tier}_${cadence}`;
}

export function formatBlcPrice(minor: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 2,
  }).format(minor / 100);
}

/** Where the code lives so a reload keeps it. */
export const BLC_CODE_STORAGE_KEY = "persistence.blc.code";
/** The chosen plan, kept across a same-tab OAuth round trip. */
export const BLC_PLAN_STORAGE_KEY = "persistence.blc.plan";
/** Where the Supabase sign-in flows return to for this page. */
export const BLC_RETURN_PATH = "/blue-light-card/callback";
export const BLC_PATH = "/blue-light-card";
export const BLC_MEMBER_SITE = "https://www.bluelightcard.co.uk/";

/** One neutral refusal for any code that does not pass — no hint as to why. */
export const BLC_INVALID_CODE_MESSAGE =
  "That code can't be used. Check it in the Blue Light Card app or contact support.";

export const BLC_COPY = {
  kicker: "Blue Light Card member offer",
  heading: "20% off Persistence Premium and Premium+.",
  intro:
    "Thank you for what you do. Blue Light Card members get 20% off Premium and Premium+, monthly or annual, for as long as the partnership runs.",

  // Ungated — no referral and no code. No price is shown here.
  ungatedHeading: "This offer is for Blue Light Card members.",
  ungatedBody:
    "Open the Persistence offer in the Blue Light Card app or website to get your member code, then come back through the link there.",
  ungatedPrimaryCta: "Go to Blue Light Card",
  ungatedSecondaryCta: "See all plans",

  codeLabel: "Blue Light Card offer code",
  codeApply: "Apply",
  codeChecking: "Checking…",
  codeValid: "Code accepted.",
  codeCheckFailed: "We couldn't check that code just now. Please try again.",

  cancelledNote: "Checkout cancelled — your code is still valid.",

  plansLabel: "Member prices",
  publicPriceLabel: "Usually",
  continueCta: (tier: string) => `Continue with ${tier}`,
  perMonth: "/mo",
  perYear: "/yr",
  billedMonthly: "Billed monthly",
  billedAnnually: "Billed annually",

  terms: [
    "For verified Blue Light Card members.",
    "One redemption per person.",
    "New subscribers only.",
    "Billed by Persistence on the web. Cancel any time.",
    "The member price continues while the partnership runs.",
    "Works in the iOS and Android app with the same account.",
  ],

  accountHeading: "Sign in to Persistence",
  accountBody:
    "Your plan belongs to the Persistence account you sign in with. Use the same sign-in method as the app.",
  checkoutHeading: "Confirm your plan",
  receiptEmailLabel: "Receipt email",
  receiptEmailHint:
    "Your receipt can go to a different email. The plan stays with the account shown above.",
  submitCta: "Continue to secure payment",
  submittingCta: "Opening secure payment…",
  changePlanCta: "Change plan",
  logOutCta: "Log out",
  challengeUnavailable:
    "The security check hasn't loaded yet. Give it a moment, or reload the page if it doesn't appear.",

  thanks: {
    kicker: "Blue Light Card member offer",
    paidHeading: "Payment received — you're in.",
    paidReady:
      "Your member plan is active. Open Persistence using the same account and sign-in method you used before paying. Your receipt email can be different.",
    paidPending:
      "Your payment is recorded. Access may take a moment to appear while we finish setting it up. If it does not appear, contact support; do not pay again.",
    pendingHeading: "Finishing up…",
    pendingBody:
      "Your payment is being confirmed. This usually takes a few seconds.",
    unfinishedHeading: "No payment was taken.",
    unfinishedBody: "Your session ended before payment completed.",
    unreachableHeading: "We can't confirm this just yet.",
    unreachableBody:
      "We can't confirm your payment just yet. Check your email for the receipt, then email us if nothing arrives within a few minutes.",
    openApp: "Open Persistence",
    backCta: "Back to the offer",
  },
} as const;
