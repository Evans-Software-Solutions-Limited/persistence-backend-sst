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
  /** The eyebrow chip above the headline. */
  eyebrow: "Blue Light Card members",
  /** The accessible name of the Persistence × Blue Light Card lockup. */
  lockupLabel: "Persistence and Blue Light Card",
  /** Stands in for the partner mark until Blue Light Card's assets arrive. */
  lockupPlaceholder: "Blue Light Card logo",

  /** "A thank-you for the people who <i>show up</i>." — the italic word is
   *  set in the serif, so the three parts are kept apart for the render. */
  headingLead: "A thank-you for the people who ",
  headingEmphasis: "show up",
  headingEnd: ".",

  intro:
    "Blue Light Card members get 20 % off Premium and Premium+. You pay on the web and use it in the app on iOS and Android. Apply your code below to unlock the member price.",

  // Ungated — no referral and no code. No price is shown here.
  ungatedBody:
    "This offer is for Blue Light Card members. Open it from the Persistence offer in the Blue Light Card app or website and your member code is applied here.",
  ungatedPrimaryCta: "Open this offer on Blue Light Card",
  ungatedSecondaryCta: "See public plans",
  proofPoints: [
    {
      heading: "Offline-first logging",
      body: "Log every set with no signal. It syncs when you are back.",
    },
    {
      heading: "Nutrition with a barcode scanner",
      body: "Scan the pack, log the meal, see it against your targets.",
    },
    {
      heading: "Apple Health and Health Connect",
      body: "Workouts, weight and steps flow both ways.",
    },
  ],

  codeLabel: "Your Blue Light Card code",
  codePlaceholder: "BLC-XXXX-XXXX",
  codeHelp: "Find it on the Persistence offer in the Blue Light Card app.",
  codeApply: "Apply",
  codeChecking: "Checking your code…",
  codeValid: "Code applied. Member prices are unlocked.",
  codeCheckFailed: "We couldn't check that code just now. Please try again.",

  cancelledNote: "Checkout cancelled — your code is still valid.",

  plansLabel: "Member prices",
  tagline: {
    premium: "Everything you log, without limits",
    premium_plus: "Training and fuel planned around you",
  } satisfies Record<BlcTier, string>,
  mostPopular: "Most popular",
  billingPeriodLabel: "Billing period",
  publicPriceLabel: "public price",
  saveChip: "Save 20 %",
  continueCta: (tier: string) => `Continue with ${tier}`,
  lockedNote: "Apply your Blue Light Card code to continue.",
  perMonth: "/mo",
  perYear: "/yr",
  billedMonthly: "Billed every month. Cancel any time.",
  billedAnnually: "Billed once a year. Cancel any time.",

  termsHeading: "Offer terms",
  /** Rendered as ONE paragraph, in this order. */
  terms: [
    "For verified Blue Light Card members.",
    "One redemption per person.",
    "New Persistence subscribers only.",
    "Billed by Persistence on the web, and you can cancel any time.",
    "The member price continues for as long as the partnership runs.",
    "Use it in the iOS and Android app with the same account.",
  ],

  accountHeading: "Sign in to the account you'll use in the app",
  accountWarning:
    "The subscription attaches to this account and cannot be moved to another one later.",
  emailLabel: "Email",
  emailPlaceholder: "you@example.com",
  emailLinkCta: "Send me a sign-in link",
  usePasswordCta: "Use a password instead",
  backCta: "Back",
  checkoutHeading: "Confirm your plan",
  receiptEmailLabel: "Receipt email",
  receiptEmailHint:
    "Your receipt can go to a different email. The plan stays with the account shown above.",
  submitCta: "Continue to secure payment",
  submittingCta: "Opening secure payment…",
  logOutCta: "Log out",
  challengeUnavailable:
    "The security check hasn't loaded yet. Give it a moment, or reload the page if it doesn't appear.",

  thanks: {
    pendingHeading: "Payment received. Setting up your access…",
    pendingBody: "This usually takes a few seconds.",
    /** Paid, but the subscription is not live yet and the page has stopped
     *  waiting for it — the buyer must not pay twice. */
    pendingSlow:
      "If access does not appear in the app, contact support — do not pay again.",
    paidLead: "You're ",
    paidEmphasis: "in",
    paidEnd: ".",
    planLabel: "Plan",
    accountLabel: "Account",
    paidNote: "Sign in with the same account you used just now.",
    unfinishedHeading: "That checkout wasn't completed.",
    unfinishedBody:
      "Nothing was charged. Your Blue Light Card code still works.",
    unreachableHeading: "We can't confirm this just yet.",
    unreachableBody:
      "We can't confirm your payment just yet. Check your email for the receipt, then email us if nothing arrives within a few minutes.",
    openApp: "Open Persistence",
    backCta: "Back to the offer",
  },
} as const;
