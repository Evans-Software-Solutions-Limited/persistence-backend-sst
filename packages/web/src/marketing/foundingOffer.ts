/**
 * The founding offer as the WEBSITE presents it (FOUNDING-OFFER BRIEF § 2,
 * 2026-09-05 amendment).
 *
 * Everything here is DATA. The wording is Brad's, transcribed from
 * `specs/milestones/MARKETING-PLANS/LANDING_PAGE.md` § 5 — the components read
 * these constants and hold no copy of their own, so a revision to that document
 * is an edit to this file and nothing else. Nothing here is written by an
 * agent, and nothing should be: if a string is missing, it is missing from
 * LANDING_PAGE.md and belongs there first.
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
  /** The tier's one-line positioning (LANDING_PAGE.md § 5.5). */
  blurb: string;
  featured?: boolean;
}

export const FOUNDING_PLANS: FoundingPlan[] = [
  {
    tier: "premium",
    months: 6,
    priceMinor: 3000,
    tierLabel: "Premium",
    termLabel: "Six months",
    blurb: "For consistent training",
  },
  {
    tier: "premium",
    months: 12,
    priceMinor: 6000,
    tierLabel: "Premium",
    termLabel: "One year",
    blurb: "For consistent training",
  },
  {
    tier: "premium_plus",
    months: 6,
    priceMinor: 5000,
    tierLabel: "Premium+",
    termLabel: "Six months",
    blurb: "Everything in Premium, plus the adaptive suite",
    featured: true,
  },
  {
    tier: "premium_plus",
    months: 12,
    priceMinor: 10000,
    tierLabel: "Premium+",
    termLabel: "One year",
    blurb: "Everything in Premium, plus the adaptive suite",
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

/**
 * Every user-facing string on `/founding`, transcribed from LANDING_PAGE.md
 * § 5. Section numbers are noted so a revision can be traced back.
 */
export const FOUNDING_COPY = {
  // § 5.2 — hero
  kicker: "Founding offer · until 30 September",
  // The same label with the deadline clause dropped, for the two places a
  // deadline is wrong: the closed state (§ 5.12, live from 1 October) and the
  // thanks page, where the buyer has already paid. Advertising "until 30
  // September" directly above "The founding offer has closed." is the failure
  // this exists to prevent.
  kickerNoDeadline: "Founding offer",
  heading: "Train with a plan. Fuel to match. See it add up.",
  intro:
    "Persistence brings training, nutrition and progress into one loop. The founding offer — six months of Premium for £30, or a year for £60 — is open until 30 September. Fixed term, nothing renews.",
  scarcityNote:
    "Founding places are limited. The offer closes on 30 September 2026, or earlier if they're gone.",

  // § 5.5 — founding prices
  plansLabel: "Founding prices",
  plansHeading: "Pick your access. Pay once.",
  plansCaption:
    "Prices in GBP, paid once. No renewal, no card stored. You'll sign up in the app with the email you pay with.",

  // § 5.6 — before checkout
  emailStepBody:
    "Use the address you'll sign in with in the app. Your access is linked to it.",
  emailLabel: "Email address",
  submitCta: "Continue to payment",
  submittingCta: "Opening secure payment…",
  backCta: "Change plan",
  termsNote:
    "By continuing you agree to the terms and conditions and ask us to start your access as soon as you sign up in the app. You keep a 14-day right to cancel for a full refund, unless you've started using the app in that time.",
  soldOutNote:
    "That plan has just sold out — pick another or check back after 30 September.",
  // Shown when the bot check has not produced a token. The checkout route
  // requires a real one, so without it the button cannot do anything — and a
  // dead button with no explanation is the worst version of that.
  challengeUnavailable:
    "The security check hasn't loaded yet. Give it a moment, or reload the page if it doesn't appear.",

  // § 5.5 — coach line. The enquiry goes to the coach FORM on Home, which the
  // doc names explicitly and which is a tracked `Lead` conversion (§ 9); a
  // `mailto:` would look equivalent and report nothing.
  coachHeading: "Coaches",
  coachBody: "Founding places for Start Up Coach+ are arranged directly —",
  coachCta: "send a coach enquiry",

  // § 5.12 — closed state, from 1 October
  closedHeading: "The founding offer has closed.",
  closedBody:
    "Thanks to everyone who joined during launch. Persistence is available on the App Store and Google Play, and founding members' feedback is already shaping what comes next.",

  // § 5.1 — banner on every marketing page except /founding
  bannerText:
    "Founding offer: six months of Premium for £30, until 30 September",
  bannerCta: "See founding prices",
  bannerDismissLabel: "Hide founding offer banner",

  // § 5.8 — thanks page
  thanks: {
    paidHeading: "Payment received — you're in.",
    paidBody:
      "Thanks. We've emailed you an invite with your access details. Next: install Persistence, sign up with that exact email address, confirm it, and your access is on the first time you open the app. Nothing else to do.",
    pendingHeading: "Finishing up…",
    pendingBody:
      "Your payment is being confirmed. This usually takes a few seconds.",
    unfinishedHeading: "No payment was taken.",
    unfinishedBody: "Your session ended before payment completed.",
    // ⚠ NOT FROM LANDING_PAGE.md. § 5.8 defines three states (paid / still
    // processing / cancelled-expired); this is a fourth the code needs and the
    // doc does not cover. It exists because the page is only reachable after a
    // payment, so telling somebody who has just paid that nothing was charged —
    // when the real fault is that WE could not reach our own API — would be a
    // lie. The wording below is a stand-in and belongs in § 5.8 first.
    //
    // It must not read "Finishing up…": that is `pendingHeading` verbatim, and
    // a buyer whose status read FAILED would be shown the same screen as one
    // whose payment is genuinely mid-flight.
    unreachableHeading: "We can't confirm this just yet.",
    unreachableBody:
      "We can't confirm your payment just yet. Check your email for the invite, then email us if nothing arrives within a few minutes.",
    backCta: "Back to founding prices",
  },

  // § 5.8 — shown on /founding?cancelled=1
  cancelledNote:
    "No payment was taken. Your session ended before payment completed.",
} as const;

export const FOUNDING_CONTACT_EMAIL = "admin@evans-software-solutions.com";
