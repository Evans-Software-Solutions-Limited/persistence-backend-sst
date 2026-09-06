/**
 * The founding offer as the WEBSITE presents it (FOUNDING-OFFER BRIEF § 2,
 * 2026-09-05 amendment).
 *
 * Everything here is DATA. The approved wording arrives with `LANDING_PAGE.md`
 * and will be dropped straight into these constants; the components below read
 * them and hold no copy of their own, so that swap is an edit to this file and
 * nothing else. Strings still awaiting that document are marked `PLACEHOLDER`.
 *
 * ⚠ The prices below are for DISPLAY. Stripe's Price object decides what a
 * buyer is actually charged, and the server never reads a figure from here —
 * it builds the Checkout Session from a Price id and stores the amount Stripe
 * reports back. If the two ever disagree, Stripe is right and this file is the
 * bug.
 */

export type FoundingTier = "premium" | "premium_plus";
export type FoundingMonths = 6 | 12;

export interface FoundingPlan {
  tier: FoundingTier;
  months: FoundingMonths;
  /** Display price in minor units, mirroring the Stripe Price. */
  priceMinor: number;
  tierLabel: string;
  termLabel: string;
  /** PLACEHOLDER until LANDING_PAGE.md. */
  blurb: string;
  featured?: boolean;
}

export const FOUNDING_PLANS: FoundingPlan[] = [
  {
    tier: "premium",
    months: 6,
    priceMinor: 3000,
    tierLabel: "Premium",
    termLabel: "6 months",
    blurb: "PLACEHOLDER — six months of Premium, paid once.",
  },
  {
    tier: "premium",
    months: 12,
    priceMinor: 6000,
    tierLabel: "Premium",
    termLabel: "12 months",
    blurb: "PLACEHOLDER — a full year of Premium, paid once.",
  },
  {
    tier: "premium_plus",
    months: 6,
    priceMinor: 5000,
    tierLabel: "Premium+",
    termLabel: "6 months",
    blurb: "PLACEHOLDER — six months of Premium+, paid once.",
    featured: true,
  },
  {
    tier: "premium_plus",
    months: 12,
    priceMinor: 10000,
    tierLabel: "Premium+",
    termLabel: "12 months",
    blurb: "PLACEHOLDER — a full year of Premium+, paid once.",
  },
];

/**
 * When the offer closes: 30 September 2026, 23:59:59 BST.
 *
 * The SAME instant the server enforces. It is duplicated rather than fetched
 * because the page must be able to render its closed state without a round
 * trip — but the server is the authority, and a client whose clock is wrong
 * still gets a 410 from the checkout route rather than a Stripe page.
 */
export const FOUNDING_OFFER_CLOSES = new Date("2026-09-30T23:59:59+01:00");

export function foundingOfferIsOpen(now: Date = new Date()): boolean {
  return now.getTime() <= FOUNDING_OFFER_CLOSES.getTime();
}

export function formatPrice(minor: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: minor % 100 === 0 ? 0 : 2,
  }).format(minor / 100);
}

/** Copy. Every string here is PLACEHOLDER until `LANDING_PAGE.md` lands. */
export const FOUNDING_COPY = {
  kicker: "Founding offer",
  heading: "PLACEHOLDER — a founding place, until 30 September",
  intro:
    "PLACEHOLDER — one payment for a fixed term of access. It does not renew, and there is nothing to cancel.",
  plansLabel: "Founding plans",
  chooseCta: "Choose",
  emailStepHeading: "PLACEHOLDER — where should we send your access?",
  emailStepBody:
    "PLACEHOLDER — use the address you'll sign in with in the app. We'll email your invite as soon as the payment clears.",
  emailLabel: "Email address",
  submitCta: "Continue to payment",
  submittingCta: "Taking you to payment…",
  backCta: "Choose a different plan",
  termsNote:
    "PLACEHOLDER — access starts as soon as your payment clears, so you agree to immediate supply and to losing the 14-day right to cancel once it does.",
  cancelledNote: "Payment cancelled — nothing has been charged.",
  // Shown when the bot check has not produced a token. The checkout route
  // requires a real one, so without it the button cannot do anything — and a
  // dead button with no explanation is the worst version of that.
  challengeUnavailable:
    "The security check hasn't loaded yet. Give it a moment, or reload the page if it doesn't appear.",
  closedHeading: "PLACEHOLDER — the founding offer has closed",
  closedBody:
    "PLACEHOLDER — thank you to everyone who took a place. The app is on the App Store and Google Play.",
  soldOutNote: "PLACEHOLDER — all founding places have been taken.",
  coachHeading: "For coaches",
  coachBody:
    "PLACEHOLDER — coach access is allocated from its own pool. Get in touch.",
  bannerText: "Founding offer — until 30 September",
  bannerCta: "See the plans",
  thanks: {
    paidHeading: "PLACEHOLDER — payment received",
    paidBody:
      "PLACEHOLDER — check your email for your invite, then sign up in the app with the same address.",
    pendingHeading: "PLACEHOLDER — finishing up…",
    pendingBody:
      "PLACEHOLDER — this usually takes a few seconds. You can leave this page open.",
    unfinishedHeading: "PLACEHOLDER — this checkout didn't complete",
    unfinishedBody:
      "PLACEHOLDER — nothing has been charged. Pick a plan to try again.",
    // Separate from "didn't complete": this page is only reachable after a
    // payment, so telling somebody who has just paid that nothing was charged
    // because WE could not reach our own API would be a lie.
    unreachableHeading: "PLACEHOLDER — we can't confirm this just yet",
    unreachableBody:
      "PLACEHOLDER — your payment may well have gone through. Check your email for the invite, and get in touch if nothing arrives.",
    backCta: "Back to the plans",
  },
} as const;

export const FOUNDING_CONTACT_EMAIL = "admin@evans-software-solutions.com";
