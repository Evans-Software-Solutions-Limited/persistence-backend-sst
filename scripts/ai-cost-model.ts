/**
 * Per-subscriber cost model: what one user can cost us at their tier's ceilings,
 * against what they pay, plus the infrastructure per user alongside it.
 *
 * ## Why this is a script and not a document
 *
 * Brad asked for the worst case of each subscription level as a sense-check on
 * pricing. The last time this was answered (2026-07-05) the answer was written as
 * prose — "~£7.30/mo worst case vs the £12.99 premium sub" — and it silently went
 * stale twice: Recipes AI added three more model-backed endpoints, and Loadout
 * added two more. Nobody noticed, because a sentence in a spec has no way to be
 * wrong out loud. So the figures live here, derived from declared inputs, and the
 * repo's own lesson applies: if a doc quotes a measurement, ship the command that
 * regenerates it.
 *
 *   bun run scripts/ai-cost-model.ts
 *
 * ## ⚠ Which numbers are MEASURED and which are ESTIMATED
 *
 * Only two unit costs have been measured end-to-end, both in the spec-21 Phase E
 * eval against real Bedrock calls: the Loadout re-map ($0.0057) and the equipment
 * scan ($0.0272). **Every other endpoint's cost here is DERIVED** from a declared
 * token profile — an honest guess at input/output sizes multiplied by real list
 * prices. Each one is flagged `measured: false`, the summary reports how much of
 * the total rests on estimates, and `TokenProfile` documents where the guess came
 * from. Treat an estimated figure as an order of magnitude, not a number to quote.
 *
 * The right fix is to read actuals out of `ai_usage_log` (which records
 * request/response byte sizes and duration per inference) or off the AWS bill, and
 * replace the profiles with measurements. Until then this model's job is to answer
 * "is any tier structurally underpriced?", which it can do on estimates, rather
 * than "what is our exact COGS", which it cannot.
 */

// ─── Inputs: model prices ────────────────────────────────────────────────────

/**
 * USD per million tokens, list price.
 *
 * ⚠ These are the ANTHROPIC list prices the Phase E eval used (`armB.ts`), not
 * Bedrock's. Bedrock is partner-priced and can differ — the eval's own comment
 * flags this as needing a check against the real AWS bill before it becomes a
 * pricing commitment. That check has not happened.
 */
export const PRICE_PER_MTOK = {
  haiku: { input: 1, output: 5 },
  opus: { input: 5, output: 25 },
} as const;

export type ModelTier = keyof typeof PRICE_PER_MTOK;

/**
 * An endpoint's per-call token shape.
 *
 * `measured: true` means the cost came from a real run and `inputTokens` /
 * `outputTokens` are back-derived from it. `measured: false` means the tokens are
 * a considered guess and the cost is computed from them.
 */
export type TokenProfile = {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly model: ModelTier;
  readonly measured: boolean;
  /** Where the numbers came from, so a reader can judge them. */
  readonly basis: string;
};

export function costPerCall(profile: TokenProfile): number {
  const price = PRICE_PER_MTOK[profile.model];
  return (
    (profile.inputTokens / 1_000_000) * price.input +
    (profile.outputTokens / 1_000_000) * price.output
  );
}

// ─── Inputs: the endpoints ───────────────────────────────────────────────────

/** Which entitlement flag gates an endpoint. */
export type Gate = "ai_access" | "loadout" | "mealprint";

export type AiEndpoint = {
  readonly key: string;
  readonly label: string;
  readonly gate: Gate;
  /** Env var name, so a reader can find the live value. */
  readonly ceilingEnv: string;
  readonly dailyCeiling: number;
  readonly profile: TokenProfile;
  /**
   * True when the ceiling is per-COACH and bounded by the roster rather than by
   * the athlete's own use. `AI_COACH_SUMMARY_DAILY_LIMIT`'s real worst case is
   * `min(2 × opened clients, ceiling)`, so on a 2-client tier the ceiling is not
   * the binding constraint — the client cap is.
   */
  readonly perClientBounded?: boolean;
  /** Plausible daily use by an engaged real user, for the median column. */
  readonly typicalPerDay: number;
};

export const AI_ENDPOINTS: readonly AiEndpoint[] = [
  {
    key: "nutrition_photo",
    label: "Snap AI — photo estimate",
    gate: "ai_access",
    ceilingEnv: "AI_PHOTO_DAILY_LIMIT",
    dailyCeiling: 12,
    typicalPerDay: 2,
    profile: {
      model: "opus",
      inputTokens: 1_100,
      outputTokens: 400,
      measured: false,
      basis:
        "640px food photo ≈ 550 image tokens (w×h/750) + ~550 prompt; a short item list out. Client downscales to 640px per design § Image transport.",
    },
  },
  {
    key: "nutrition_text",
    label: "Snap AI — free-text estimate",
    gate: "ai_access",
    ceilingEnv: "AI_TEXT_DAILY_LIMIT",
    dailyCeiling: 30,
    typicalPerDay: 3,
    profile: {
      model: "haiku",
      inputTokens: 500,
      outputTokens: 300,
      measured: false,
      basis: "One meal description in, an item list out. Text-only.",
    },
  },
  {
    key: "recipe_extract",
    label: "Recipes AI — photo extraction",
    gate: "ai_access",
    ceilingEnv: "AI_RECIPE_DAILY_LIMIT",
    dailyCeiling: 12,
    typicalPerDay: 0.2,
    profile: {
      model: "opus",
      inputTokens: 1_100,
      outputTokens: 1_200,
      measured: false,
      basis:
        "Same image budget as the food photo, but a whole ingredient list + method out — the largest output of any endpoint, which is why it dominates the estimated half.",
    },
  },
  {
    key: "recipe_estimate",
    label: "Recipes AI — whole-recipe macros",
    gate: "ai_access",
    // ⚠ NOT registered in `infra/api.ts` — the handler falls back to its code
    // default of 30. Harmless today, but invisible to anyone auditing cost from
    // the env block, which is where every other ceiling lives.
    ceilingEnv: "AI_RECIPE_ESTIMATE_DAILY_LIMIT (unset — code default)",
    dailyCeiling: 30,
    typicalPerDay: 0.5,
    profile: {
      model: "haiku",
      inputTokens: 800,
      outputTokens: 200,
      measured: false,
      basis: "Ingredient lines + servings in, one macro block out.",
    },
  },
  {
    key: "resolve_ingredient",
    label: "Recipes AI — ingredient resolve",
    gate: "ai_access",
    ceilingEnv: "AI_RESOLVE_DAILY_LIMIT",
    dailyCeiling: 60,
    typicalPerDay: 2,
    profile: {
      model: "haiku",
      inputTokens: 300,
      outputTokens: 100,
      measured: false,
      basis: "One ingredient string in, one food match out. The cheapest call.",
    },
  },
  {
    key: "coach_summary",
    label: "Coach AI client summary",
    gate: "ai_access",
    ceilingEnv: "AI_COACH_SUMMARY_DAILY_LIMIT",
    dailyCeiling: 40,
    perClientBounded: true,
    typicalPerDay: 1,
    profile: {
      model: "haiku",
      inputTokens: 3_000,
      outputTokens: 600,
      measured: false,
      basis:
        "Synthesis over Client Detail modules a–f, so the largest INPUT of any endpoint; short prose out.",
    },
  },
  {
    key: "loadout_remap",
    label: "Loadout — adapt a workout",
    gate: "loadout",
    ceilingEnv: "AI_LOADOUT_REMAP_DAILY_LIMIT",
    dailyCeiling: 30,
    typicalPerDay: 1,
    profile: {
      model: "haiku",
      inputTokens: 4_200,
      outputTokens: 300,
      measured: true,
      basis:
        "MEASURED — Phase E2 bake-off, 58 swap-bearing fixtures: $0.0057/adaptation. Tokens back-derived from that cost.",
    },
  },
  {
    key: "meal_suggest",
    label: "Mealprint — suggest a meal",
    gate: "mealprint",
    ceilingEnv: "AI_MEAL_SUGGEST_DAILY_LIMIT",
    dailyCeiling: 20,
    // Deciding what to eat is a per-MEAL action, so a few a day for an engaged
    // user — the same order as the Loadout re-map, not the once-per-gym scan.
    typicalPerDay: 2,
    profile: {
      model: "haiku",
      inputTokens: 4_200,
      outputTokens: 300,
      measured: false,
      basis:
        "spec-26 design § Cost: ~£0.006/suggest. Text-only composition over a ~200-candidate list — declared as the SAME shape as the Loadout re-map, so the re-map's measured token profile is reused. Inherits that measurement's basis, not its confidence: the candidate list length is an estimate.",
    },
  },
  {
    key: "equipment_scan",
    label: "Loadout — scan a gym",
    gate: "loadout",
    ceilingEnv: "AI_EQUIPMENT_SCAN_DAILY_LIMIT",
    dailyCeiling: 6,
    // A scan is once-per-GYM, not once-per-day: `saved_gyms` persists it. This is
    // the whole argument for 6 rather than 10.
    typicalPerDay: 0.1,
    profile: {
      model: "opus",
      inputTokens: 3_000,
      outputTokens: 488,
      measured: true,
      basis:
        "MEASURED — Phase E1, 7 photos at 1568px: $0.0272/scan, mean 10.1s. Tokens back-derived.",
    },
  },
] as const;

// ─── Inputs: the tier catalog ────────────────────────────────────────────────

export type Tier = {
  readonly name: string;
  readonly label: string;
  /** GBP/month, from `subscription_tiers.price_monthly`. */
  readonly priceMonthly: number;
  readonly aiAccess: boolean;
  readonly loadoutAccess: boolean;
  /**
   * `subscription_tiers.mealprint_access` (migration 20260803120200).
   *
   * ⚠ Deliberately NOT the same set as {@link loadoutAccess}: Mealprint is
   * premium_plus ONLY, while Loadout also reaches all three trainer tiers. That
   * asymmetry is the open pricing question, and modelling it as one flag would
   * hide exactly the number needed to settle it.
   */
  readonly mealprintAccess: boolean;
  /** `trainer_client_limit`, or null for an athlete tier. */
  readonly clientLimit: number | null;
  /** False for `premium_plus` until the launch flip. */
  readonly isActive: boolean;
};

/** Live catalog after `20260526120000_simplify_tier_model` + the premium_plus row. */
export const TIERS: readonly Tier[] = [
  {
    name: "free",
    label: "Free",
    priceMonthly: 0,
    aiAccess: false,
    loadoutAccess: false,
    mealprintAccess: false,
    clientLimit: null,
    isActive: true,
  },
  {
    name: "premium",
    label: "Premium",
    priceMonthly: 12.99,
    aiAccess: true,
    loadoutAccess: false,
    mealprintAccess: false,
    clientLimit: null,
    isActive: true,
  },
  {
    name: "premium_plus",
    label: "Premium+",
    priceMonthly: 29.99,
    aiAccess: true,
    loadoutAccess: true,
    mealprintAccess: true,
    clientLimit: null,
    isActive: false,
  },
  {
    name: "individual_trainer",
    label: "Individual Trainer",
    priceMonthly: 14.99,
    aiAccess: true,
    loadoutAccess: true,
    mealprintAccess: false,
    clientLimit: 2,
    isActive: true,
  },
  {
    name: "small_business",
    label: "Small Business",
    priceMonthly: 75,
    aiAccess: true,
    loadoutAccess: true,
    mealprintAccess: false,
    clientLimit: 30,
    isActive: true,
  },
  {
    name: "medium_enterprise",
    label: "Medium/Enterprise",
    priceMonthly: 300,
    aiAccess: true,
    loadoutAccess: true,
    mealprintAccess: false,
    clientLimit: 500,
    isActive: true,
  },
] as const;

// ─── Inputs: revenue and infrastructure ──────────────────────────────────────

/**
 * GBP→USD. ⚠ A hardcoded rate, because the alternative is a network call in a
 * script that should run offline. Model costs are USD and prices are GBP, so every
 * ratio below moves with this.
 */
export const USD_PER_GBP = 1.27;

/**
 * Apple's commission. **15 %** assumes enrolment in the Small Business Program
 * (under $1M/yr), which is where this business is. Pass 0.3 to see the standard
 * rate — it is the single biggest lever on every ratio in the output.
 */
export const APPLE_COMMISSION = 0.15;

/**
 * RevenueCat takes 1 % of tracked revenue above $2.5k/month. Modelled as a flat
 * 1 % because the model is meant to be pessimistic, and below that threshold it
 * simply overstates cost slightly.
 */
export const REVENUECAT_RATE = 0.01;

/**
 * Fixed monthly platform cost, USD, independent of user count.
 *
 * ⚠ **ESTIMATED — not read from a bill.** These are the services the repo
 * demonstrably uses (Supabase, AWS, Expo/EAS, Sentry). The point of listing them
 * individually is that the per-user figure is dominated by how many subscribers
 * this is divided across, not by the line items themselves.
 */
export const FIXED_MONTHLY_USD: readonly {
  readonly item: string;
  readonly usd: number;
}[] = [
  { item: "Supabase Pro (incl. compute)", usd: 35 },
  { item: "AWS baseline (NAT/logs/secrets/S3)", usd: 25 },
  { item: "Expo EAS", usd: 99 },
  { item: "Sentry", usd: 26 },
];

/**
 * Marginal request-driven infrastructure per active user per month, USD.
 *
 * ⚠ ESTIMATED. Derived from ~2,000 API calls/user/month at API Gateway HTTP API
 * ($1.00/M requests) plus Lambda at ~300 ms / 512 MB per call, plus CloudWatch
 * ingest. It comes out near-zero, which is the useful finding: **serving requests
 * is not what this platform costs.** Fixed services and AI inference are.
 */
export const MARGINAL_INFRA_USD_PER_USER = 0.02;

// ─── The model ───────────────────────────────────────────────────────────────

const DAYS = 30;

/** Which endpoints a tier can actually reach. */
export function endpointsForTier(tier: Tier): readonly AiEndpoint[] {
  return AI_ENDPOINTS.filter((endpoint) =>
    endpoint.gate === "loadout"
      ? tier.loadoutAccess
      : endpoint.gate === "mealprint"
        ? tier.mealprintAccess
        : tier.aiAccess,
  );
}

/**
 * The ceiling that actually binds for this tier and endpoint.
 *
 * Two corrections, both of which move a headline number:
 *
 * - **The coach summary's real worst case is `min(2 × opened clients, ceiling)`**,
 *   so on the 2-client Individual Trainer tier the ROSTER binds at 4/day, not the
 *   env's 40. Ignoring that overstates that tier's exposure ~10× — and it is the
 *   tier with the thinnest headroom, so the error would land exactly where it
 *   matters most.
 * - **An ATHLETE tier cannot reach the coach summary at all**, so its ceiling is 0.
 *   The endpoint is `POST /trainers/me/clients/:clientId/ai-summary` and it needs a
 *   trainer↔client relationship (`assertTrainerCanActForClient`); a Premium athlete
 *   has no `:clientId` they can act for. Gating this on `ai_access` alone — which is
 *   what the flag on the endpoint says — would charge Premium $7.20/mo for a route
 *   it cannot call, and Premium is the tier this analysis is most worried about.
 */
export function bindingCeiling(tier: Tier, endpoint: AiEndpoint): number {
  if (endpoint.perClientBounded) {
    if (tier.clientLimit == null) return 0;
    return Math.min(endpoint.dailyCeiling, 2 * tier.clientLimit);
  }
  return endpoint.dailyCeiling;
}

export type TierCost = {
  readonly tier: Tier;
  /** Net revenue after Apple + RevenueCat, USD/month. */
  readonly netRevenueUsd: number;
  /** Every reachable ceiling consumed every day for 30 days, USD/month. */
  readonly worstCaseAiUsd: number;
  /** Plausible engaged use, USD/month. */
  readonly typicalAiUsd: number;
  /** How much of the worst case rests on ESTIMATED unit costs. */
  readonly worstCaseEstimatedShare: number;
  readonly perEndpoint: readonly {
    readonly label: string;
    readonly ceiling: number;
    readonly perCallUsd: number;
    readonly worstCaseUsd: number;
    readonly measured: boolean;
  }[];
};

export function tierCost(tier: Tier): TierCost {
  const gross = tier.priceMonthly * USD_PER_GBP;
  const netRevenueUsd = gross * (1 - APPLE_COMMISSION) * (1 - REVENUECAT_RATE);

  const perEndpoint = endpointsForTier(tier)
    // A zero ceiling means the tier cannot reach the endpoint (see
    // `bindingCeiling`), so it is dropped rather than listed at $0.00 — a row of
    // zeroes in the breakdown reads as "free", not "unreachable".
    .filter((endpoint) => bindingCeiling(tier, endpoint) > 0)
    .map((endpoint) => {
      const perCallUsd = costPerCall(endpoint.profile);
      const ceiling = bindingCeiling(tier, endpoint);
      return {
        label: endpoint.label,
        ceiling,
        perCallUsd,
        worstCaseUsd: perCallUsd * ceiling * DAYS,
        measured: endpoint.profile.measured,
      };
    });

  const worstCaseAiUsd = perEndpoint.reduce(
    (sum, e) => sum + e.worstCaseUsd,
    0,
  );
  const estimatedPortion = perEndpoint
    .filter((e) => !e.measured)
    .reduce((sum, e) => sum + e.worstCaseUsd, 0);

  const typicalAiUsd = endpointsForTier(tier)
    .filter((endpoint) => bindingCeiling(tier, endpoint) > 0)
    .reduce(
      (sum, endpoint) =>
        sum +
        // Typical use is also capped by what binds — a 2-client coach cannot make
        // more summaries per day than they have clients to make them about.
        costPerCall(endpoint.profile) *
          Math.min(endpoint.typicalPerDay, bindingCeiling(tier, endpoint)) *
          DAYS,
      0,
    );

  return {
    tier,
    netRevenueUsd,
    worstCaseAiUsd,
    typicalAiUsd,
    worstCaseEstimatedShare:
      worstCaseAiUsd === 0 ? 0 : estimatedPortion / worstCaseAiUsd,
    perEndpoint,
  };
}

export function fixedMonthlyTotalUsd(): number {
  return FIXED_MONTHLY_USD.reduce((sum, line) => sum + line.usd, 0);
}

/** Fixed cost amortised across `subscribers`, plus the marginal per-user slice. */
export function infraPerUserUsd(subscribers: number): number {
  if (subscribers <= 0) return Number.POSITIVE_INFINITY;
  return fixedMonthlyTotalUsd() / subscribers + MARGINAL_INFRA_USD_PER_USER;
}

// ─── Report ──────────────────────────────────────────────────────────────────

const SCALE_POINTS = [100, 1_000, 10_000] as const;

function usd(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return `$${n.toFixed(2)}`;
}

function pct(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(0)}%`;
}

export function report(): string {
  const lines: string[] = [];

  lines.push("AI + infrastructure cost per subscriber");
  lines.push(
    `Assumptions: £1 = $${USD_PER_GBP} · Apple ${pct(APPLE_COMMISSION)} · RevenueCat ${pct(REVENUECAT_RATE)} · ${DAYS}-day month`,
  );
  lines.push(
    `⚠ Only ${AI_ENDPOINTS.filter((e) => e.profile.measured).length} of ${AI_ENDPOINTS.length} unit costs are MEASURED; the other ${AI_ENDPOINTS.filter((e) => !e.profile.measured).length} are derived from declared token profiles.`,
  );
  lines.push("");

  lines.push(
    "Tier                | £/mo   | net $/mo | worst AI | % of net | typical AI | % of net | est. share",
  );
  lines.push(
    "--------------------+--------+----------+----------+----------+------------+----------+-----------",
  );

  for (const tier of TIERS) {
    const cost = tierCost(tier);
    const worstShare =
      cost.netRevenueUsd === 0 ? NaN : cost.worstCaseAiUsd / cost.netRevenueUsd;
    const typicalShare =
      cost.netRevenueUsd === 0 ? NaN : cost.typicalAiUsd / cost.netRevenueUsd;
    lines.push(
      [
        (tier.label + (tier.isActive ? "" : " (unlaunched)")).padEnd(19),
        `£${tier.priceMonthly.toFixed(2)}`.padStart(6),
        usd(cost.netRevenueUsd).padStart(8),
        usd(cost.worstCaseAiUsd).padStart(8),
        pct(worstShare).padStart(8),
        usd(cost.typicalAiUsd).padStart(10),
        pct(typicalShare).padStart(8),
        pct(cost.worstCaseEstimatedShare).padStart(10),
      ].join(" | "),
    );
  }

  lines.push("");
  lines.push(
    `Infrastructure — fixed ${usd(fixedMonthlyTotalUsd())}/mo + ${usd(MARGINAL_INFRA_USD_PER_USER)}/user marginal:`,
  );
  for (const point of SCALE_POINTS) {
    lines.push(
      `  ${String(point).padStart(6)} subscribers → ${usd(infraPerUserUsd(point))}/user/mo`,
    );
  }

  lines.push("");
  lines.push("Worst-case AI breakdown, by tier:");
  for (const tier of TIERS) {
    const cost = tierCost(tier);
    if (cost.perEndpoint.length === 0) {
      lines.push(`  ${tier.label}: no AI endpoints reachable`);
      continue;
    }
    lines.push(`  ${tier.label}:`);
    for (const endpoint of [...cost.perEndpoint].sort(
      (a, b) => b.worstCaseUsd - a.worstCaseUsd,
    )) {
      lines.push(
        `    ${endpoint.label.padEnd(34)} ${String(endpoint.ceiling).padStart(3)}/day × ${usd(endpoint.perCallUsd)} = ${usd(endpoint.worstCaseUsd).padStart(7)}${endpoint.measured ? "  (measured)" : ""}`,
      );
    }
  }

  return lines.join("\n");
}

// `require.main` is undefined under vitest's ESM loader, so the report only prints
// when the file is executed directly.
if (typeof require !== "undefined" && require.main === module) {
  console.log(report());
}
