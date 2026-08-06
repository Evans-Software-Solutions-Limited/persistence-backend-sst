export const ADAPTIVE_SUITE = ["Loadout", "Mealprint"] as const;
export const ADAPTIVE_SUITE_LABEL = "Loadout + Mealprint";

export type SubscriptionAudience = "consumer" | "coach" | "org";
export type SubscriptionRail = "iap" | "web";
export type BillingCadence = "monthly" | "annual";

export type CatalogTierId =
  | "free"
  | "premium"
  | "premium_plus"
  | "individual_trainer"
  | "start_up_coach_plus"
  | "coach"
  | "coach_pro"
  | "studio"
  | "studio_pro"
  | "enterprise";

export interface CatalogTier {
  id: CatalogTierId;
  name: string;
  audience: SubscriptionAudience;
  tagline: string;
  /** Static prices are only valid for free/web-only plans. IAP prices are live. */
  monthly: number | null;
  annual: number | null;
  clients: number | "200+" | null;
  suite: boolean;
  rail: SubscriptionRail;
  features: readonly string[];
  highlight?: boolean;
  invoiced?: boolean;
  provisionalMonthly?: boolean;
  provisionalAnnual?: boolean;
  cta?: "trial" | "buy" | "contact";
}

/**
 * Layout and feature catalog approved in spec-29 on 2026-08-05. IAP prices do
 * not live here: native surfaces resolve them from StoreKit/RevenueCat by
 * product id, while web surfaces join `/subscription-tiers` by tier id.
 */
export const SUBSCRIPTION_CATALOG = [
  {
    id: "free",
    name: "Free",
    audience: "consumer",
    tagline: "Get moving",
    monthly: 0,
    annual: null,
    clients: null,
    suite: false,
    rail: "iap",
    features: [
      "Full workout and set logging",
      "Nutrition tracking and barcode scanner",
      "Streaks, PRs and core progress",
      "3 custom workouts",
    ],
  },
  {
    id: "premium",
    name: "Premium",
    audience: "consumer",
    tagline: "For consistent training",
    monthly: null,
    annual: null,
    clients: null,
    suite: false,
    rail: "iap",
    features: [
      "Everything in Free",
      "Unlimited workouts and history",
      "Photo and free-text AI nutrition logging",
      "Smart swap suggestions",
    ],
  },
  {
    id: "premium_plus",
    name: "Premium+",
    audience: "consumer",
    tagline: "Everything in Premium, plus the adaptive suite",
    monthly: null,
    annual: null,
    clients: null,
    suite: true,
    rail: "iap",
    highlight: true,
    features: [
      "Everything in Premium",
      "Loadout — equipment-aware training",
      "Mealprint — AI meal planning around your targets",
      "Programme import from PDF or spreadsheet",
    ],
  },
  {
    id: "individual_trainer",
    name: "Start Up Coach",
    audience: "coach",
    tagline: "Start coaching",
    monthly: null,
    annual: null,
    clients: 5,
    suite: false,
    rail: "iap",
    features: [
      "Coach tools and client management",
      "Programme builder",
      "Up to 5 clients",
    ],
  },
  {
    id: "start_up_coach_plus",
    name: "Start Up Coach +",
    audience: "coach",
    tagline: "Coaching plus the adaptive suite",
    monthly: null,
    annual: null,
    clients: 5,
    suite: true,
    rail: "iap",
    features: [
      "Everything in Start Up Coach",
      "Adaptive suite included",
      "Up to 5 clients",
    ],
  },
  {
    id: "coach",
    name: "Coach",
    audience: "coach",
    tagline: "For a growing roster",
    monthly: null,
    annual: null,
    clients: 15,
    suite: true,
    rail: "iap",
    features: [
      "Coach tools and adaptive suite",
      "Bulk programme assignment",
      "Up to 15 clients",
    ],
  },
  {
    id: "coach_pro",
    name: "Coach Pro",
    audience: "coach",
    tagline: "For a full book of clients",
    monthly: null,
    annual: null,
    clients: 30,
    suite: true,
    rail: "iap",
    features: [
      "Coach tools and adaptive suite",
      "Priority AI throughput",
      "Up to 30 clients",
    ],
  },
  {
    id: "studio",
    name: "Studio",
    audience: "org",
    tagline: "For studios and gyms",
    monthly: 179.99,
    annual: null,
    clients: 75,
    suite: true,
    rail: "web",
    cta: "trial",
    features: [
      "For gyms, studios, clinics and teams",
      "Seat management and anonymised insights",
      "Up to 75 members",
    ],
  },
  {
    id: "studio_pro",
    name: "Studio Pro",
    audience: "org",
    tagline: "For multiple locations",
    monthly: 229.99,
    annual: null,
    clients: 200,
    suite: true,
    rail: "web",
    cta: "trial",
    highlight: true,
    features: [
      "Everything in Studio",
      "Multi-location seat pools",
      "Up to 200 members",
    ],
  },
  {
    id: "enterprise",
    name: "Enterprise",
    audience: "org",
    tagline: "Custom and invoiced",
    monthly: null,
    annual: null,
    clients: "200+",
    suite: true,
    rail: "web",
    cta: "contact",
    invoiced: true,
    features: [
      "Everything in Studio Pro",
      "SSO, DPA and works-council support",
      "200+ members, invoiced",
    ],
  },
] as const satisfies readonly CatalogTier[];

export function catalogTier(id: CatalogTierId): CatalogTier {
  const tier = SUBSCRIPTION_CATALOG.find((candidate) => candidate.id === id);
  if (!tier) throw new Error(`Unknown subscription tier: ${id}`);
  return tier;
}

export function tiersFor(audience: SubscriptionAudience): CatalogTier[] {
  return SUBSCRIPTION_CATALOG.filter((tier) => tier.audience === audience);
}

export function formatGbp(value: number): string {
  if (value === 0) return "£0";
  return `£${value.toLocaleString("en-GB", {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: Number.isInteger(value) ? 0 : 2,
  })}`;
}

export interface TierPricing {
  monthly: number | null;
  annual: number | null;
  /** Used to avoid deriving savings across store/API currency boundaries. */
  monthlySource?: "static" | "api" | "store";
  annualSource?: "static" | "api" | "store";
  /** Store-localised labels when available (for example `£16.99`). */
  monthlyLabel?: string;
  annualLabel?: string;
  /** Store-localised monthly equivalent of the annual product. */
  annualMonthlyEquivalentLabel?: string;
}

export function staticTierPricing(tier: CatalogTier): TierPricing {
  return {
    monthly: tier.monthly,
    annual: tier.annual,
    monthlySource: "static",
    annualSource: "static",
  };
}

export function annualSaving(pricing: TierPricing): number | null {
  if (!pricing.annual || !pricing.monthly) return null;
  if (
    pricing.monthlySource !== undefined &&
    pricing.annualSource !== undefined &&
    pricing.monthlySource !== pricing.annualSource
  ) {
    return null;
  }
  return Math.round((1 - pricing.annual / (pricing.monthly * 12)) * 100);
}

export function monthlyEquivalent(pricing: TierPricing): number | null {
  return pricing.annual === null ? null : pricing.annual / 12;
}

export type CatalogCta = {
  label: string;
  enabled: boolean;
  kind: "free" | "soon" | "iap" | "trial" | "buy" | "contact";
};

export function ctaFor(
  tier: CatalogTier,
  { iapAvailable = false }: { iapAvailable?: boolean } = {},
): CatalogCta {
  if (tier.rail === "web") {
    if (tier.cta === "contact") {
      return { label: "Talk to us", enabled: true, kind: "contact" };
    }
    if (tier.cta === "buy") {
      return { label: "Buy", enabled: true, kind: "buy" };
    }
    return { label: "Start trial", enabled: true, kind: "trial" };
  }

  if (tier.id === "free") {
    return { label: "Continue free", enabled: true, kind: "free" };
  }

  return iapAvailable
    ? { label: `Choose ${tier.name}`, enabled: true, kind: "iap" }
    : { label: "Coming soon", enabled: false, kind: "soon" };
}
