/**
 * Mealprint (spec-26) — the client-side mirror of the Phase 0/1 backend
 * contract (PR #350). Preferences (T-0.6) and fill-my-macros suggestions
 * (T-1.5).
 *
 * ## Three contracts this file exists to keep visible at the type level
 *
 * 1. **{@link MealSuggestResult.labelCheckRequired} is the disclaimer's ONLY
 *    trigger, and it is always `true`.** The server returns it unconditionally
 *    and says why in `nutritionAiMealSuggestHandler`'s docstring:
 *    `mapOffAllergenTags` returns `[]` — which reads as "analysed, nothing
 *    found" — whenever a product has ingredient text, *without knowing OFF
 *    actually parsed it*. A foreign-language ingredient list, a "see packaging"
 *    placeholder and a genuinely clean analysis are indistinguishable, and those
 *    are the rows most likely to be wrong. So gating {@link LABEL_CHECK_COPY} on
 *    the narrower {@link MealSuggestResult.containsUnverified} would suppress it
 *    exactly where it matters most. `containsUnverified` is the STRONGER
 *    "we don't know what is in this at all" signal and is rendered separately.
 *
 * 2. **{@link LABEL_CHECK_COPY} is AC 1.2 verbatim and is a legal surface.** Do
 *    not paraphrase, shorten, or split it across elements. Same for
 *    {@link MEDICAL_SCOPE_COPY} (AC 1.5 / locked decision 10).
 *
 * 3. **`partialEnforcementOnly` must never imply certification.** Halal and
 *    kosher certification appears nowhere in the Open Food Facts data, so the
 *    backend enforces only the determinable subset and flags the gap. See
 *    {@link partialEnforcementCopy}, which names exactly what is enforced and
 *    nothing more (locked decision 10).
 *
 * Every vocabulary below MIRRORS
 * `microservices/core/src/application/nutrition/mealprint/preferences/vocabulary.ts`
 * and the CHECK constraints in `20260803120100_nutrition_preferences.sql`. A
 * value this file allows and the server does not earns a 400 naming the field;
 * a value the server allows and this file does not is simply unreachable from
 * the app. Keep all three in step.
 */

import type { MealSlot } from "./nutrition";

// ─── Day plans (STORY-004/005, spec-26 Phase 2) ─────────────────────────────
//
// Mirrors `microservices/core/src/application/repositories/mealPlanRepository.ts`
// (`MealPlanDTO`/`MealPlanMealDTO`) and the three plan-AI handlers
// (`nutritionAiPlanGenerateHandler` / `nutritionAiPlanMealSwapHandler` /
// `nutritionPlanMealReplaceHandler`). camelCase == wire shape (passthrough),
// same convention as the rest of this file.
//
// ⚠ **A generated/swapped item now carries `kind` + per-SERVING macros** (both
// `nutritionAiPlanGenerateHandler` and `nutritionAiPlanMealSwapHandler`, closing
// the mealprint item-kind gap). Before this, `items` were `{ candidateId,
// servings, name }` — no way to tell a curated-food id from a recipe/meal id, so
// `planAcceptMealInputFromGenerated` sent every item as a `foodId` and a
// recipe/meal-backed meal 400'd `unresolvable_items` on accept even though the
// draft rendered fine. `unresolvableCandidateIds` + `planDraftMealsAffectedBy`
// still exist as the defence-in-depth path for a draft that somehow reaches
// accept with a stale/foreign id (preferences changed mid-review, a row was
// deleted) — that is a real 400 the client cannot prevent, not the routing bug
// this file used to have.
//
// `POST /nutrition/plans` (accept) and the `/replace` route take REFERENCES
// ONLY: a SEPARATE `recipeId`/`mealId` field (at most one of each — the DB row
// has one column per kind) plus an `items: {foodId, servings}[]` array for
// food-kind items, never a single polymorphic list. `planAcceptMealInputFromGenerated`
// buckets a meal's items by `kind` and routes each bucket to its field — see
// that function's docstring for the one edge it cannot represent (more than one
// recipe-kind OR more than one meal-kind item in the SAME composed meal; the
// schema has only one `recipeId` slot and one `mealId` slot).
//
// The per-item macros are what let the draft's serving stepper (AC 4.4) recompute
// a meal's totals deterministically, client-side, without a round trip — see
// {@link setPlanItemServings}.

/** Plan meals reuse the Fuel log's fixed four slots (locked decision 6). */
export type LogSlot = MealSlot;

export type PlanStatus = "draft" | "active" | "archived";
export type PlanMealState = "planned" | "logged" | "skipped";

export type PlanMealItemRef = {
  readonly foodId: string;
  readonly servings: number;
};

/** One meal inside an ACCEPTED plan (`meal_plan_meals` row). */
export type PlanMeal = {
  readonly id: string;
  readonly sortOrder: number;
  readonly label: string;
  readonly logSlot: LogSlot;
  readonly recipeId: string | null;
  readonly mealId: string | null;
  readonly items: readonly PlanMealItemRef[] | null;
  readonly kcal: number;
  readonly proteinG: number;
  readonly carbsG: number;
  readonly fatG: number;
  readonly aiReason: string | null;
  readonly state: PlanMealState;
  readonly loggedEntryId: string | null;
};

/** An accepted day plan (`meal_plans` + its `meal_plan_meals`). */
export type MealPlan = {
  readonly id: string;
  readonly userId: string;
  readonly status: PlanStatus;
  readonly planDate: string;
  readonly groupId: string | null;
  readonly mealsPerDay: number;
  readonly effortLevel: EffortLevel;
  readonly targetKcal: number;
  readonly targetProteinG: number;
  readonly targetCarbsG: number;
  readonly targetFatG: number;
  readonly source: string;
  readonly createdByUserId: string | null;
  readonly createdAt: string | null;
  readonly acceptedAt: string | null;
  readonly meals: readonly PlanMeal[];
};

export type PlanTarget = {
  readonly kcal: number;
  readonly proteinG: number;
  readonly carbsG: number;
  readonly fatG: number;
};

/** `POST /nutrition/ai/plan-generate` body — AC 4.1/4.2. */
export type PlanGenerateInput = {
  readonly planDate: string;
  readonly mealsPerDay?: number;
  readonly effortLevel?: EffortLevel;
  readonly steer?: string;
};

export type PlanGeneratedItem = {
  readonly candidateId: string;
  readonly kind: "food" | "recipe" | "meal";
  readonly servings: number;
  readonly name: string;
  /**
   * Per ONE serving — the server's own recompute basis, never the model's
   * output. Multiply by `servings` for this item's contribution to the meal
   * total. Lets {@link setPlanItemServings} recompute a meal deterministically
   * when the user edits an item's portion, with no round trip.
   */
  readonly kcal: number;
  readonly proteinG: number;
  readonly carbsG: number;
  readonly fatG: number;
};

/** Bounds mirroring the server-enforced AI candidate portion policy. */
export const MIN_PLAN_ITEM_SERVINGS = 0.25;
export const MAX_PLAN_ITEM_SERVINGS = 2;
/** The stepper's tap increment (AC 4.4). */
export const PLAN_ITEM_SERVINGS_STEP = 0.25;

/** One meal in a DRAFT (not-yet-persisted) plan — server-verified, never accepted as-is. */
export type PlanGeneratedMeal = {
  readonly name: string;
  /** Untrusted model prose. Render as plain text only. */
  readonly reason: string;
  readonly logSlot: LogSlot;
  readonly items: readonly PlanGeneratedItem[];
  readonly kcal: number;
  readonly proteinG: number;
  readonly carbsG: number;
  readonly fatG: number;
  /** TRUE when an item's allergen content is unknown (AC 2.2). */
  readonly containsUnverified: boolean;
  /**
   * TRUE when this meal failed the server's stage-3 avoidance re-run. Design §
   * 1: "failing meal returned flagged (plan)". Render it as needing a swap —
   * never silently include it, never auto-drop it either.
   */
  readonly flaggedUnsafe: boolean;
  /** Server-detected AI portion issue; swap is required before acceptance. */
  readonly flaggedPortion?: boolean;
};

export type PlanGenerateEmptyReason = "no_targets" | "no_candidates";

/** `POST /nutrition/ai/plan-generate` response envelope. */
export type PlanGenerateResult = {
  readonly meals: readonly PlanGeneratedMeal[];
  /** The selected count used to derive every per-meal ceiling. */
  readonly mealsPerDay?: number;
  readonly emptyReason: PlanGenerateEmptyReason | null;
  readonly target: PlanTarget | null;
  readonly totals: PlanTarget | null;
  /** A HINT for the UI, not a gate — the user can accept a plan that misses it. */
  readonly withinTolerance: boolean;
  readonly labelCheckRequired: boolean;
};

/** One meal inside a `POST /nutrition/plans` (accept) or `.../replace` body. */
export type PlanAcceptMealInput = {
  readonly label: string;
  readonly logSlot: LogSlot;
  readonly recipeId?: string;
  readonly mealId?: string;
  /** Multiplier for a recipe/meal-backed row. Items carry their own. */
  readonly servings?: number;
  readonly items?: readonly PlanMealItemRef[];
  readonly aiReason?: string;
};

/** `POST /nutrition/plans` body — AC 4.5. References only, NEVER macros. */
export type PlanAcceptInput = {
  readonly planDate: string;
  readonly mealsPerDay: number;
  /** Phase 3 week plans share one; a day plan omits it. */
  readonly groupId?: string;
  readonly meals: readonly PlanAcceptMealInput[];
};

/** `POST .../meals/:mealId/replace` body — same shape as one accept meal. */
export type PlanReplaceInput = PlanAcceptMealInput;

/**
 * `POST /nutrition/ai/plan-meal-swap` body — AC 4.4. Stateless: the caller
 * supplies the day target and the macros of every meal it is HOLDING (not
 * touched by this swap); the server composes ONE replacement to fit what's
 * left. Serves both a pre-accept draft swap (holding the other draft meals)
 * and a post-accept edit (holding the other saved meals) — nothing is read or
 * written server-side either way.
 */
export type PlanSwapInput = {
  readonly dayTarget: PlanTarget;
  readonly heldTotals: PlanTarget;
  readonly logSlot: LogSlot;
  readonly mealsPerDay: number;
  readonly steer?: string;
};

export type PlanSwapMeal = {
  readonly name: string;
  readonly reason: string;
  readonly logSlot: LogSlot;
  readonly items: readonly PlanGeneratedItem[];
  readonly kcal: number;
  readonly proteinG: number;
  readonly carbsG: number;
  readonly fatG: number;
  readonly containsUnverified: boolean;
};

export type PlanSwapEmptyReason = "budget_exhausted" | "no_candidates";

export type PlanSwapResult = {
  readonly meal: PlanSwapMeal | null;
  readonly emptyReason: PlanSwapEmptyReason | null;
  readonly labelCheckRequired: boolean;
};

/** `POST .../meals/:mealId/log` response — AC 5.2. */
export type PlanMealLogResult = {
  readonly planMealId: string;
  readonly loggedEntryId: string;
  readonly alreadyLogged: boolean;
};

/** `PATCH /nutrition/plans/:id` body — archive XOR re-date, never both. */
export type PlanPatchInput =
  | { readonly status: "archived" }
  | { readonly planDate: string };

// ─── Draft-review client state (AC 4.3/4.4) ─────────────────────────────────
//
// A working copy of a generated plan, held client-side until Accept. Mirrors
// the `MealprintDraft` shape above: nothing here is logged/persisted, and
// design § 4 calls for "Zustand for the draft-review state" — `state/plan-flow.ts`
// is that store; these are its pure value types + transforms so the store and
// its tests don't reinvent the arithmetic.

export type PlanDraftMeal = {
  /** Client-generated stable key — the draft has no server id yet. */
  readonly localId: string;
  readonly meal: PlanGeneratedMeal;
};

export type PlanDraft = {
  readonly planDate: string;
  readonly target: PlanTarget;
  readonly mealsPerDay: number;
  readonly meals: readonly PlanDraftMeal[];
};

/** `null` when the result carried no target (the `no_targets`/`no_candidates` empty states). */
export function planDraftFromResult(
  planDate: string,
  result: PlanGenerateResult,
  idFactory: () => string,
): PlanDraft | null {
  if (result.target === null) return null;
  return {
    planDate,
    target: result.target,
    mealsPerDay: result.mealsPerDay ?? result.meals.length,
    meals: result.meals.map((meal) => ({ localId: idFactory(), meal })),
  };
}

/**
 * Recompute one item's contribution: its per-serving macros × its servings.
 */
function planItemTotal(item: PlanGeneratedItem): PlanTarget {
  return {
    kcal: item.kcal * item.servings,
    proteinG: item.proteinG * item.servings,
    carbsG: item.carbsG * item.servings,
    fatG: item.fatG * item.servings,
  };
}

/**
 * Recompute a meal's totals from its OWN items — deterministic and exact,
 * because every item carries the resolved candidate's per-serving macros
 * (gap 2 / AC 4.4). Rounded to 1dp, matching the server's own rounding
 * convention, so a re-summed meal displays identically to one fresh off
 * generate/swap.
 */
export function recomputePlanMealTotals(
  meal: PlanGeneratedMeal,
): PlanGeneratedMeal {
  const totals = meal.items.reduce(
    (acc, item) => {
      const t = planItemTotal(item);
      return {
        kcal: acc.kcal + t.kcal,
        proteinG: acc.proteinG + t.proteinG,
        carbsG: acc.carbsG + t.carbsG,
        fatG: acc.fatG + t.fatG,
      };
    },
    { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 },
  );
  const round = (n: number) => Math.round(n * 10) / 10;
  return {
    ...meal,
    kcal: round(totals.kcal),
    proteinG: round(totals.proteinG),
    carbsG: round(totals.carbsG),
    fatG: round(totals.fatG),
  };
}

/**
 * Set ONE item's servings within a meal and recompute the meal's totals —
 * the serving stepper's core operation (AC 4.4). Clamped to the same band the
 * server itself clamps a model's servings to
 * ({@link MIN_PLAN_ITEM_SERVINGS}/{@link MAX_PLAN_ITEM_SERVINGS}), so a
 * hand-typed or repeatedly-tapped value can't drift outside anything the
 * server would ever itself produce — accept still recomputes authoritatively
 * from this value, this is just what the draft SHOWS in the meantime.
 */
export function setPlanItemServings(
  meal: PlanGeneratedMeal,
  candidateId: string,
  servings: number,
): PlanGeneratedMeal {
  const clamped = Math.min(
    MAX_PLAN_ITEM_SERVINGS,
    Math.max(MIN_PLAN_ITEM_SERVINGS, servings),
  );
  return recomputePlanMealTotals({
    ...meal,
    items: meal.items.map((item) =>
      item.candidateId === candidateId ? { ...item, servings: clamped } : item,
    ),
  });
}

/**
 * Deterministic day-total recompute from the KEPT meals. Exact, because
 * `PlanGeneratedMeal.kcal`/etc. are always either the server-verified sum
 * (fresh off generate/swap) or {@link recomputePlanMealTotals}'s own re-sum
 * (after a serving edit) — never a value this function has to reconstruct
 * itself. Removing a meal and re-summing the rest is exact; so is editing an
 * item's servings and re-summing.
 */
export function sumPlanDraftTotals(
  meals: readonly PlanDraftMeal[],
): PlanTarget {
  return meals.reduce(
    (acc, { meal }) => ({
      kcal: acc.kcal + meal.kcal,
      proteinG: acc.proteinG + meal.proteinG,
      carbsG: acc.carbsG + meal.carbsG,
      fatG: acc.fatG + meal.fatG,
    }),
    { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 },
  );
}

export function planDraftHasFlaggedMeal(
  meals: readonly PlanDraftMeal[],
): boolean {
  return meals.some(({ meal }) => meal.flaggedUnsafe || meal.flaggedPortion);
}

export function removePlanDraftMeal(
  draft: PlanDraft,
  localId: string,
): PlanDraft {
  return { ...draft, meals: draft.meals.filter((m) => m.localId !== localId) };
}

export function replacePlanDraftMeal(
  draft: PlanDraft,
  localId: string,
  newMeal: PlanGeneratedMeal,
): PlanDraft {
  return {
    ...draft,
    meals: draft.meals.map((m) =>
      m.localId === localId ? { ...m, meal: newMeal } : m,
    ),
  };
}

/** The macros of every OTHER draft meal — what a swap's `heldTotals` holds. */
export function heldTotalsExcluding(
  draft: PlanDraft,
  localId: string,
): PlanTarget {
  return sumPlanDraftTotals(draft.meals.filter((m) => m.localId !== localId));
}

/**
 * Build the accept/replace-shaped input for one generated/swapped meal,
 * routing each item to the field its `kind` resolves against — `foodId`s into
 * `items[]`, a `recipe`-kind item into `recipeId`, a `meal`-kind item into
 * `mealId`. This is what closes the item-kind gap: previously every item was
 * sent as a `foodId` regardless of kind, so a meal the AI composed from one of
 * the user's own recipes/saved meals 400'd `unresolvable_items` on accept.
 *
 * ⚠ **At most one `recipeId` and one `mealId` are representable per accepted
 * meal** — `meal_plan_meals` has exactly one `recipe_id` column and one
 * `meal_id` column, not an array. If a composed meal ever carries MORE than
 * one recipe-kind item (or more than one meal-kind item) — not something
 * today's prompts ask for, but not schema-forbidden either — the FIRST of
 * each kind wins and any extra is dropped from the accept payload. That is a
 * pre-existing shape limit of the accept schema (spec-26), not something this
 * change introduces or attempts to lift.
 *
 * The one `servings` field on the accept body is the multiplier for
 * whichever of `recipeId`/`mealId` is present; food items carry their own
 * per-item `servings` inside `items[]`, unaffected. ⚠ If a single meal ever
 * carries BOTH a recipe-kind and a meal-kind item, that one `servings` (the
 * recipe's — `primary`) is applied to both on the backend, so the meal item's
 * own servings is not independently representable. Same one-column-per-kind
 * schema limit as above; today's prompts do not compose recipe + meal together.
 *
 * ⚠ **An item whose `kind` is missing or unrecognized is treated as a FOOD.**
 * This is deliberate and is the pre-`kind` behaviour: before this field existed
 * every item was sent as a `foodId`, so it either resolved or 400'd
 * `unresolvable_items` — never silently vanished. Bucketing food as
 * "not recipe and not meal" (rather than `=== "food"`) keeps that guarantee
 * under DEPLOY SKEW: this client talking to a backend that has not yet shipped
 * the `kind`-stamping generate/swap handlers returns items with no `kind`, and
 * routing those to nothing would degrade the meal to zero items / zero macros
 * and store a silent empty meal — the exact corruption the accept handler
 * exists to reject. Default-to-food restores "store correctly or 400".
 */
export function planAcceptMealInputFromGenerated(
  meal: PlanGeneratedMeal | PlanSwapMeal,
): PlanAcceptMealInput {
  // "not recipe and not meal" — NOT `=== "food"` — so a missing/unknown kind
  // defaults to food. See the docstring's deploy-skew note; this is the guard.
  const foodItems = meal.items.filter(
    (item) => item.kind !== "recipe" && item.kind !== "meal",
  );
  const recipeItem = meal.items.find((item) => item.kind === "recipe");
  const mealItem = meal.items.find((item) => item.kind === "meal");
  const primary = recipeItem ?? mealItem;

  return {
    label: meal.name,
    logSlot: meal.logSlot,
    ...(recipeItem ? { recipeId: recipeItem.candidateId } : {}),
    ...(mealItem ? { mealId: mealItem.candidateId } : {}),
    ...(primary ? { servings: primary.servings } : {}),
    ...(foodItems.length > 0
      ? {
          items: foodItems.map((item) => ({
            foodId: item.candidateId,
            servings: item.servings,
          })),
        }
      : {}),
    aiReason: meal.reason,
  };
}

export function planDraftToAcceptInput(draft: PlanDraft): PlanAcceptInput {
  return {
    planDate: draft.planDate,
    mealsPerDay: draft.mealsPerDay,
    meals: draft.meals.map(({ meal }) =>
      planAcceptMealInputFromGenerated(meal),
    ),
  };
}

/**
 * Parse a `unresolvable_items` 400's `items: string[]` (`"food:<id>"` /
 * `"recipe:<id>"` / `"meal:<id>"`) down to the bare ids, so a draft meal can be
 * matched against it regardless of which kind the server thought it was.
 */
export function unresolvableCandidateIds(
  items: readonly string[],
): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const entry of items) {
    const idx = entry.indexOf(":");
    ids.add(idx === -1 ? entry : entry.slice(idx + 1));
  }
  return ids;
}

/** Which draft meals (by `localId`) reference one of the unresolvable ids. */
export function planDraftMealsAffectedBy(
  draft: PlanDraft,
  unresolvableIds: ReadonlySet<string>,
): ReadonlySet<string> {
  const affected = new Set<string>();
  for (const { localId, meal } of draft.meals) {
    if (meal.items.some((item) => unresolvableIds.has(item.candidateId))) {
      affected.add(localId);
    }
  }
  return affected;
}

// ─── Accepted-plan reads (STORY-005) ─────────────────────────────────────────

export type PlanAdherence = {
  readonly loggedCount: number;
  readonly totalCount: number;
  readonly loggedTotals: PlanTarget;
};

/** Planned-vs-logged rollup for the Today/adherence view (AC 5.3). */
export function computePlanAdherence(plan: MealPlan): PlanAdherence {
  const logged = plan.meals.filter((m) => m.state === "logged");
  return {
    loggedCount: logged.length,
    totalCount: plan.meals.length,
    loggedTotals: logged.reduce(
      (acc, m) => ({
        kcal: acc.kcal + m.kcal,
        proteinG: acc.proteinG + m.proteinG,
        carbsG: acc.carbsG + m.carbsG,
        fatG: acc.fatG + m.fatG,
      }),
      { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 },
    ),
  };
}

/** The first not-yet-logged meal, by `sortOrder` — the entry card's "Next:" line. */
export function nextUnloggedPlanMeal(plan: MealPlan): PlanMeal | null {
  const unlogged = plan.meals
    .filter((m) => m.state === "planned")
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder);
  return unlogged[0] ?? null;
}

/** Planned-but-unlogged meals mapped to one Fuel log slot — the ghost rows (AC 5.1). */
export function plannedMealsForSlot(
  plan: MealPlan | null,
  slot: LogSlot,
): readonly PlanMeal[] {
  if (plan === null) return [];
  return plan.meals
    .filter((m) => m.logSlot === slot && m.state === "planned")
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

// ─── Vocabularies (mirror the backend, AC 1.1) ───────────────────────────────

export const DIETARY_PATTERNS = [
  "vegetarian",
  "vegan",
  "pescatarian",
  "halal",
  "kosher",
  "dairy_free",
  "gluten_free",
] as const;

export type DietaryPattern = (typeof DIETARY_PATTERNS)[number];

/**
 * The UK FIC 14-allergen set — Brad signed this chip set off 2026-07-24, and it
 * is the CEILING of the allergen vocabulary. Anything outside it is a dislike
 * ({@link MealprintPreferences.avoidFoods}), which is name-matched and carries
 * no safety claim.
 */
export const AVOID_ALLERGENS = [
  "celery",
  "gluten",
  "crustaceans",
  "eggs",
  "fish",
  "lupin",
  "milk",
  "molluscs",
  "mustard",
  "nuts",
  "peanuts",
  "sesame",
  "soybeans",
  "sulphites",
] as const;

export type AllergenKey = (typeof AVOID_ALLERGENS)[number];

export const EFFORT_LEVELS = ["quick", "balanced", "high_maintenance"] as const;
export type EffortLevel = (typeof EFFORT_LEVELS)[number];

/** v1 ships en-GB only (locked decision 5); the field exists so adding one is data. */
export const SUPPORTED_LOCALES = ["en-GB"] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const MIN_MEALS_PER_DAY = 2;
export const MAX_MEALS_PER_DAY = 6;

// ─── Guards ─────────────────────────────────────────────────────────────────
//
// ⚠ These exist because `MealprintPreferences` types its arrays as `string[]`,
// not as the unions. That is faithful to the wire: the handler validates against
// the closed vocabularies, but a row written by an OLDER app build against a
// NEWER server (or vice versa, after a vocabulary extension) can carry a value
// this build has no label, chip or rule for.
//
// Filtering through these rather than casting is what keeps that harmless. A cast
// would render a chip with an `undefined` label and — worse — echo the unknown
// value straight back on the next save, so a user who edited their preferences on
// an old build would silently re-assert a pattern they cannot see.

const DIETARY_PATTERN_SET: ReadonlySet<string> = new Set(DIETARY_PATTERNS);
export function isDietaryPattern(value: string): value is DietaryPattern {
  return DIETARY_PATTERN_SET.has(value);
}

const ALLERGEN_SET: ReadonlySet<string> = new Set(AVOID_ALLERGENS);
export function isAllergenKey(value: string): value is AllergenKey {
  return ALLERGEN_SET.has(value);
}

const EFFORT_SET: ReadonlySet<string> = new Set(EFFORT_LEVELS);
export function isEffortLevel(value: string): value is EffortLevel {
  return EFFORT_SET.has(value);
}

// ─── Display labels ─────────────────────────────────────────────────────────

export const DIETARY_PATTERN_LABELS: Readonly<Record<DietaryPattern, string>> =
  {
    vegetarian: "Vegetarian",
    vegan: "Vegan",
    pescatarian: "Pescatarian",
    halal: "Halal",
    kosher: "Kosher",
    dairy_free: "Dairy-free",
    gluten_free: "Gluten-free",
  };

/**
 * ⚠ These are the REGULATED allergen names, not friendlier synonyms.
 *
 * "Nuts" stays "Tree nuts" and peanuts stay separate because the backend tags
 * them separately and folding them together would misreport which chip caused
 * an exclusion — `ALLERGEN_OFF_TAGS.nuts` deliberately excludes `en:peanuts`. A
 * user who avoids both picks both chips, and the labels have to make that
 * obvious rather than looking like a duplicate.
 */
export const ALLERGEN_LABELS: Readonly<Record<AllergenKey, string>> = {
  celery: "Celery",
  gluten: "Gluten",
  crustaceans: "Crustaceans",
  eggs: "Eggs",
  fish: "Fish",
  lupin: "Lupin",
  milk: "Milk",
  molluscs: "Molluscs",
  mustard: "Mustard",
  nuts: "Tree nuts",
  peanuts: "Peanuts",
  sesame: "Sesame",
  soybeans: "Soya",
  sulphites: "Sulphites",
};

export const EFFORT_LEVEL_LABELS: Readonly<Record<EffortLevel, string>> = {
  quick: "Quick & simple",
  balanced: "Balanced",
  high_maintenance: "High-maintenance",
};

export const EFFORT_LEVEL_BLURBS: Readonly<Record<EffortLevel, string>> = {
  quick: "Minimal cooking, few ingredients",
  balanced: "A normal amount of cooking",
  high_maintenance: "Batch-prep and proper cooking",
};

// ─── Preferences (AC 1.1–1.5) ───────────────────────────────────────────────

/**
 * `GET /nutrition/preferences` — the 404-free read. The endpoint returns
 * {@link DEFAULT_MEALPRINT_PREFERENCES} with `isDefault: true` when the user has
 * no row, so no consumer needs a "did you mean empty?" branch.
 */
export type MealprintPreferences = {
  readonly userId: string;
  readonly dietaryPatterns: readonly string[];
  readonly avoidAllergens: readonly string[];
  readonly avoidFoods: readonly string[];
  readonly likedFoods: readonly string[];
  readonly mealsPerDay: number;
  readonly effortLevel: EffortLevel;
  readonly locale: string;
  readonly updatedAt: string | null;
  /**
   * TRUE when no row exists and these are the defaults.
   *
   * ⚠ This is what distinguishes "skipped the wizard" from "deliberately chose
   * the default shape", and it is why the entry card can offer a first-run
   * wizard without guessing. Comparing against the defaults would misfire the
   * moment a user saves them on purpose.
   */
  readonly isDefault: boolean;
};

/**
 * `PUT /nutrition/preferences` body. Server-side the arrays are validated
 * against the closed vocabularies and the free-text entries are normalised on
 * write, so the client sends what the user typed and reads back the canonical
 * form.
 */
export type SetMealprintPreferencesInput = {
  readonly dietaryPatterns: readonly DietaryPattern[];
  readonly avoidAllergens: readonly AllergenKey[];
  readonly avoidFoods: readonly string[];
  readonly likedFoods: readonly string[];
  readonly mealsPerDay: number;
  readonly effortLevel: EffortLevel;
  readonly locale: SupportedLocale;
};

/** AC 1.4 — the wizard is skippable, and this is what a skip means. */
export const DEFAULT_MEALPRINT_PREFERENCES: SetMealprintPreferencesInput = {
  dietaryPatterns: [],
  avoidAllergens: [],
  avoidFoods: [],
  likedFoods: [],
  mealsPerDay: 4,
  effortLevel: "balanced",
  locale: "en-GB",
};

/**
 * Free-text caps, duplicated from the backend's `MAX_FREE_TEXT_*` so the editor
 * refuses an over-long entry inline instead of round-tripping for a 400.
 *
 * Not arbitrary on either side: every entry is rendered into the model prompt,
 * so an unbounded list is an unbounded prompt — a cost channel AND a steering
 * channel the user controls.
 */
export const MAX_FREE_TEXT_ITEMS = 60;
export const MAX_FREE_TEXT_LENGTH = 120;

/** Bound on the suggest steer, mirroring the handler's `t.String({ maxLength: 200 })`. */
export const MAX_STEER_LENGTH = 200;

// ─── Copy that is a contract, not a string ──────────────────────────────────

/**
 * AC 1.2 / AC 3.4, **verbatim**. Rendered whenever
 * {@link MealSuggestResult.labelCheckRequired} is true (always) and whenever an
 * allergen chip is active in the preferences editor.
 *
 * ⚠ Do not paraphrase or abbreviate this. It is the only thing standing between
 * a tag-derived filter and a user treating it as an allergen guarantee, and the
 * literature the spec cites (§ Market context: ~78 % of free nutrition apps
 * failed basic allergen flagging) is why it is worded as a limitation rather
 * than a reassurance.
 */
export const LABEL_CHECK_COPY =
  "Mealprint filters known ingredients, but always check labels — it can't verify allergens or cross-contamination.";

/** AC 1.5 / locked decision 10 — shown in the preferences wizard footer. */
export const MEDICAL_SCOPE_COPY =
  "Mealprint is a fitness and lifestyle feature, not medical advice. If you have a medical condition or a clinically managed diet, speak to a healthcare professional.";

/**
 * The name of what a `partialEnforcementOnly` pattern actually enforces —
 * never a claim about certification, which does not exist in the data.
 *
 * The lists mirror `DIETARY_PATTERN_RULES` exactly: `halal` applies the pork and
 * alcohol axes; `kosher` applies pork and shellfish (fin fish with scales is
 * kosher, so the seafood axis is deliberately NOT applied). Returns `null` when
 * no partially-enforceable pattern is active, so callers render nothing rather
 * than an empty caveat.
 */
export function partialEnforcementCopy(
  patterns: readonly string[],
): string | null {
  const halal = patterns.includes("halal");
  const kosher = patterns.includes("kosher");
  if (!halal && !kosher) return null;

  // Union of the enforced axes, in a fixed order so the sentence is stable.
  const enforced: string[] = ["pork"];
  if (halal) enforced.push("alcohol");
  if (kosher) enforced.push("shellfish");

  const which =
    halal && kosher ? "Halal and kosher" : halal ? "Halal" : "Kosher";
  return `${which} certification isn't in our food data, so Mealprint can only exclude ${formatList(enforced)} by ingredient. Check for certification yourself.`;
}

/**
 * One-line summary of saved preferences, for the Fuel Targets row.
 *
 * `null` when there is nothing to summarise — either the row is unknown on this
 * device or it is the untouched default. The caller renders its own "Not set up
 * yet" in that case, so this never has to guess which of the two it is.
 *
 * ⚠ Allergens are named FIRST and counted separately from dislikes, never merged
 * into one total. They are the safety-relevant list, and a summary reading
 * "5 foods avoided" would flatten "2 allergens" into the same sentence as
 * "3 things I find boring" — the exact conflation the editor's chip styling
 * exists to prevent.
 *
 * ⚠ **Every field is treated as untrusted, because this runs during render.**
 * `getMealprintPreferences` is an unvalidated passthrough over the wire, so a
 * server-side vocabulary extension shipped ahead of an app update lands values
 * this build has no label for — and an unguarded
 * `EFFORT_LEVEL_LABELS[effortLevel].toLowerCase()` is then a TypeError inside
 * `FuelTargetsContainer`'s render, i.e. a white screen on the Targets tab rather
 * than a missing word. The array reads are guarded for the same reason: the sync
 * path validates their presence (`isMealprintPreferencesEcho`) and the GET path
 * does not.
 */
export function summarisePreferences(
  preferences: MealprintPreferences | null,
): string | null {
  if (preferences === null || preferences.isDefault) return null;

  const parts: string[] = [];
  const patterns = (preferences.dietaryPatterns ?? []).filter(isDietaryPattern);
  if (patterns.length > 0) {
    parts.push(
      formatList(patterns.map((pattern) => DIETARY_PATTERN_LABELS[pattern])),
    );
  }
  const allergenCount = (preferences.avoidAllergens ?? []).length;
  if (allergenCount > 0) {
    parts.push(
      `${allergenCount} allergen${allergenCount === 1 ? "" : "s"} avoided`,
    );
  }
  const dislikeCount = (preferences.avoidFoods ?? []).length;
  if (dislikeCount > 0) {
    parts.push(`${dislikeCount} disliked`);
  }
  if (Number.isFinite(preferences.mealsPerDay)) {
    parts.push(`${preferences.mealsPerDay} meals a day`);
  }
  // Dropped rather than rendered as "undefined" — see the docstring.
  if (isEffortLevel(preferences.effortLevel)) {
    parts.push(EFFORT_LEVEL_LABELS[preferences.effortLevel].toLowerCase());
  }
  // Everything was unreadable → nothing worth summarising.
  return parts.length > 0 ? parts.join(" · ") : null;
}

/**
 * The caveat to show when the SERVER flagged `partialEnforcementOnly` but this
 * device does not know which pattern caused it.
 *
 * ⚠ Deliberately vaguer than {@link partialEnforcementCopy}, which names the
 * enforced axes. Reachable when the preferences fetch has not landed or has
 * failed — at which point naming "pork and alcohol" would be a guess about which
 * of halal/kosher is active. Saying less is the only honest option, and saying
 * nothing is not (locked decision 10).
 */
export const GENERIC_PARTIAL_ENFORCEMENT_COPY =
  "One of your dietary requirements can't be fully checked from our food data — Mealprint excludes what it can identify by ingredient, but there's no certification information. Check for yourself.";

/** "a", "a and b", "a, b and c" — en-GB serial comma omitted. */
function formatList(items: readonly string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0]!;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]!}`;
}

// ─── Suggestions (STORY-003) ────────────────────────────────────────────────

export type SuggestShape = "snack" | "meal" | "either";

export const SUGGEST_SHAPE_LABELS: Readonly<Record<SuggestShape, string>> = {
  snack: "Snack",
  meal: "Meal",
  either: "Either",
};

/**
 * The occasion layer (amendment 2026-08, § A.1). `shape` is meaningful only
 * for `on_plan` — `cheat_meal` always returns exactly 2 cards, `eating_out`
 * composes restaurant-oriented "best order" cards, and the server ignores
 * `shape` for either. Default `on_plan` on both sides.
 */
export type SuggestOccasion = "on_plan" | "cheat_meal" | "eating_out";

export const SUGGEST_OCCASION_LABELS: Readonly<
  Record<SuggestOccasion, string>
> = {
  on_plan: "On plan",
  cheat_meal: "Cheat meal",
  eating_out: "Eating out",
};

/**
 * `POST /nutrition/ai/meal-suggest` body. `date` is the DEVICE's local day, not
 * server time — the same reason `GET /nutrition/today` takes it: deriving it
 * server-side would give a user in NZ the wrong day's entries.
 *
 * `occasion` defaults to `on_plan` server-side when omitted; this client
 * always sends it explicitly (see `MealprintSuggestSheetContainer`). For
 * `eating_out`, `steer` carries the restaurant name rather than a craving.
 */
export type MealSuggestInput = {
  readonly shape: SuggestShape;
  readonly date: string;
  readonly steer?: string;
  readonly occasion?: SuggestOccasion;
};

/**
 * One composed item inside a suggestion. Every macro here was **recomputed
 * server-side from the resolved database row × servings** — the model is never
 * allowed to emit a number (locked decision 1). Render these as authoritative.
 */
export type MealSuggestionItem = {
  readonly candidateId: string;
  readonly kind: "food" | "recipe" | "meal";
  readonly name: string;
  readonly servings: number;
  readonly servingLabel: string;
  readonly kcal: number;
  readonly proteinG: number;
  readonly carbsG: number;
  readonly fatG: number;
  /** TRUE when this item's allergen content is UNKNOWN (AC 2.2). */
  readonly unverified: boolean;
};

export type MealSuggestion = {
  readonly name: string;
  /** Untrusted model prose. Render as plain text only — never markup or a link. */
  readonly reason: string;
  readonly items: readonly MealSuggestionItem[];
  readonly kcal: number;
  readonly proteinG: number;
  readonly carbsG: number;
  readonly fatG: number;
  /** TRUE when ANY item's allergen content is unknown. */
  readonly containsUnverified: boolean;
  /** TRUE when an active pattern cannot be fully enforced (halal/kosher). */
  readonly partialEnforcementOnly: boolean;
  /**
   * TRUE for a `cheat_meal` card (amendment § A.2). Drives the ember accent —
   * see `MealprintSuggestSheetPresenter`'s `SuggestionCard`.
   */
  readonly cheat: boolean;
  /**
   * TRUE for an `eating_out` card. The primary action reads "Save order"
   * instead of "Log it", but still routes through the same draft-confirm →
   * log flow (amendment § A.3 decision 3 — no separate saved-orders store).
   */
  readonly isOrder: boolean;
  /**
   * `"Have it"` / `"Smart swap"` (cheat_meal) or `"Meal"` / `"Snack"`
   * (eating_out); `null` for `on_plan`. Rendered as a small pill on the card.
   */
  readonly tag: string | null;
};

export type MealSuggestRemaining = {
  readonly kcal: number;
  readonly proteinG: number;
  readonly carbsG: number;
  readonly fatG: number;
};

/**
 * Why an otherwise-successful request returned nothing.
 *
 * ⚠ These are **200s carrying an answer**, not failures — "you have 40 kcal
 * left" and "your restrictions exclude everything we stock" are things the
 * client can say precisely, and neither consumed the user's daily ceiling.
 *
 * ⚠ `no_candidates` is the EXPECTED state for any user with an allergen chip set
 * until the Open Food Facts re-seed lands: the tag columns are NULL on all
 * ~144k seeded rows and `avoidanceFilter` treats NULL as unknown-and-unsafe, so
 * every curated food is excluded from an allergen-filtered pool. That is correct
 * fail-closed behaviour, so the copy for this state must be actionable
 * (loosen a chip / add your own foods) rather than reading as a bug.
 */
export type MealSuggestEmptyReason =
  | "no_targets"
  | "budget_exhausted"
  | "no_candidates";

export type MealSuggestResult = {
  readonly suggestions: readonly MealSuggestion[];
  readonly emptyReason: MealSuggestEmptyReason | null;
  /** `null` on every empty result — there was no usable budget to report. */
  readonly remaining: MealSuggestRemaining | null;
  readonly containsUnverified: boolean;
  readonly partialEnforcementOnly: boolean;
  /** ⚠ Always true. See this file's docstring, contract 1. */
  readonly labelCheckRequired: boolean;
};

/**
 * A suggestion staged for logging: the server's suggestion plus the per-item
 * keep/drop state the review step owns. Nothing is logged until the user
 * confirms (locked decision 3).
 */
export type MealprintDraftItem = MealSuggestionItem & { readonly on: boolean };

export type MealprintDraft = {
  readonly suggestion: MealSuggestion;
  readonly items: readonly MealprintDraftItem[];
  readonly slot: MealSlot;
};

/** Sum of the kept items' kcal — what the confirm button reports. */
export function sumKeptDraftKcal(items: readonly MealprintDraftItem[]): number {
  return items.reduce(
    (total, item) => (item.on ? total + item.kcal : total),
    0,
  );
}

/** Every suggestion item starts kept: the server already verified the whole composition. */
export function draftFromSuggestion(
  suggestion: MealSuggestion,
  slot: MealSlot,
): MealprintDraft {
  return {
    suggestion,
    items: suggestion.items.map((item) => ({ ...item, on: true })),
    slot,
  };
}
