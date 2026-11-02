/**
 * Per-call AI cost table, shared by the per-user AI budget
 * (`microservices/core/src/application/ai/aiBudget.ts`) and the pricing model
 * (`scripts/ai-cost-model.ts`) so the two cannot drift (spec-29 design § 2,
 * task 1.1).
 *
 * ⚠ Only two profiles are MEASURED (Phase E). Every other one is an estimate
 * from a declared token shape, flagged `measured: false`. Replace them with
 * real figures (Bedrock CloudWatch token metrics ÷ invocations) as they become
 * available — the budget and the pricing model both move with this file.
 *
 * Keys are the `ai_usage_log.endpoint` strings each handler writes, because the
 * budget prices a user's spend by counting those rows.
 */

/**
 * USD per million tokens, Anthropic list price. Bedrock EU inference profiles
 * add ~10 %; the budget is a fail-safe, not an invoice, so list price is close
 * enough and errs slightly generous to the user.
 */
export const PRICE_PER_MTOK = {
  haiku: { input: 1, output: 5 },
  opus: { input: 5, output: 25 },
} as const;

export type ModelTier = keyof typeof PRICE_PER_MTOK;

/**
 * An endpoint's per-call token shape. `measured: true` means the cost came from
 * a real run and the tokens are back-derived from it; `false` means the tokens
 * are a considered guess.
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

export type AiCostEntry = {
  /** Stable key used by the pricing model. */
  readonly key: string;
  /** The exact `ai_usage_log.endpoint` string the handler writes. */
  readonly usageEndpoint: string;
  readonly profile: TokenProfile;
};

export const AI_COSTS = {
  nutrition_photo: {
    key: "nutrition_photo",
    usageEndpoint: "/nutrition/ai/estimate",
    profile: {
      model: "opus",
      inputTokens: 1_100,
      outputTokens: 400,
      measured: false,
      basis:
        "640px food photo ≈ 550 image tokens (w×h/750) + ~550 prompt; a short item list out. Client downscales to 640px per design § Image transport.",
    },
  },
  nutrition_text: {
    key: "nutrition_text",
    usageEndpoint: "/nutrition/ai/estimate-text",
    profile: {
      model: "haiku",
      inputTokens: 500,
      outputTokens: 300,
      measured: false,
      basis: "One meal description in, an item list out. Text-only.",
    },
  },
  recipe_extract: {
    key: "recipe_extract",
    usageEndpoint: "extract-recipe",
    profile: {
      model: "opus",
      inputTokens: 1_100,
      outputTokens: 1_200,
      measured: false,
      basis:
        "Same image budget as the food photo, but a whole ingredient list + method out — the largest output of any endpoint, which is why it dominates the estimated half.",
    },
  },
  recipe_estimate: {
    key: "recipe_estimate",
    usageEndpoint: "estimate-recipe",
    profile: {
      model: "haiku",
      inputTokens: 800,
      outputTokens: 200,
      measured: false,
      basis: "Ingredient lines + servings in, one macro block out.",
    },
  },
  resolve_ingredient: {
    key: "resolve_ingredient",
    usageEndpoint: "resolve-ingredient",
    profile: {
      model: "haiku",
      inputTokens: 300,
      outputTokens: 100,
      measured: false,
      basis: "One ingredient string in, one food match out. The cheapest call.",
    },
  },
  recipe_import: {
    key: "recipe_import",
    usageEndpoint: "/recipes/import",
    profile: {
      model: "haiku",
      inputTokens: 4_000,
      outputTokens: 900,
      measured: false,
      basis:
        "Readable page text when a recipe page has no structured data: up to 24k chars (~6k tokens), typically far less; output capped at 900 tokens (`aiRecipeFromText.ts`).",
    },
  },
  coach_summary: {
    key: "coach_summary",
    usageEndpoint: "/trainers/me/clients/:clientId/ai-summary",
    profile: {
      model: "haiku",
      inputTokens: 3_000,
      outputTokens: 600,
      measured: false,
      basis:
        "Synthesis over Client Detail modules a–f, so a large INPUT; short prose out.",
    },
  },
  loadout_remap: {
    key: "loadout_remap",
    usageEndpoint: "/workouts/:id/loadout/preview",
    profile: {
      model: "haiku",
      inputTokens: 4_200,
      outputTokens: 300,
      measured: true,
      basis:
        "MEASURED — Phase E2 bake-off, 58 swap-bearing fixtures: $0.0057/adaptation. Tokens back-derived from that cost.",
    },
  },
  meal_suggest: {
    key: "meal_suggest",
    usageEndpoint: "/nutrition/ai/meal-suggest",
    profile: {
      model: "haiku",
      inputTokens: 4_200,
      outputTokens: 300,
      measured: false,
      basis:
        "spec-26 design § Cost: ~£0.006/suggest. Text-only composition over a ~200-candidate list — declared as the SAME shape as the Loadout re-map, so the re-map's measured token profile is reused. Inherits that measurement's basis, not its confidence.",
    },
  },
  meal_plan_generate: {
    key: "meal_plan_generate",
    usageEndpoint: "/nutrition/ai/plan-generate",
    profile: {
      model: "haiku",
      inputTokens: 4_200,
      outputTokens: 2_000,
      measured: false,
      basis:
        "Same candidate-list input as a suggestion, but a whole day of 4–6 meals out: `planMaxTokens` allows 256 + 320/meal, design § sizing predicts 1.5–2.5k.",
    },
  },
  meal_plan_swap: {
    key: "meal_plan_swap",
    usageEndpoint: "/nutrition/ai/plan-meal-swap",
    profile: {
      model: "haiku",
      inputTokens: 4_200,
      outputTokens: 300,
      measured: false,
      basis:
        "Replaces one meal in a plan — the same shape as a single suggestion.",
    },
  },
  equipment_scan: {
    key: "equipment_scan",
    usageEndpoint: "/ai/equipment-scan",
    profile: {
      model: "opus",
      inputTokens: 3_000,
      outputTokens: 488,
      measured: true,
      basis:
        "MEASURED — Phase E1, 7 photos at 1568px: $0.0272/scan, mean 10.1s. Tokens back-derived.",
    },
  },
} as const satisfies Record<string, AiCostEntry>;

export type AiCostKey = keyof typeof AI_COSTS;

const COST_BY_USAGE_ENDPOINT: ReadonlyMap<string, number> = new Map(
  Object.values(AI_COSTS).map((entry) => [
    entry.usageEndpoint,
    costPerCall(entry.profile),
  ]),
);

/** The most expensive call in the table. */
export const MAX_COST_PER_CALL_USD = Math.max(
  ...COST_BY_USAGE_ENDPOINT.values(),
);

/**
 * USD cost of one call to the endpoint that writes `usageEndpoint` to
 * `ai_usage_log`. An endpoint missing from the table is priced at the most
 * expensive call, so a forgotten entry can only make the budget stricter,
 * never looser.
 */
export function costPerUsageEndpoint(usageEndpoint: string): number {
  return COST_BY_USAGE_ENDPOINT.get(usageEndpoint) ?? MAX_COST_PER_CALL_USD;
}
