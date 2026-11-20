import { t, type Static } from "elysia";
import type { FoodRepository } from "../../repositories/foodRepository";
import type { RecipeRepository } from "../../repositories/recipeRepository";
import type { MealRepository } from "../../repositories/mealRepository";
import {
  isUuid,
  type UserMealRepository,
} from "../../repositories/userMealRepository";
import type {
  CreateEntryInput,
  MealSlot,
} from "../../repositories/nutritionEntryRepository";

/**
 * The `POST /nutrition/entries` body fields, exactly as 1.2.0 sends them.
 * Shared by the single create and every entry of the batch so the two can
 * never drift. Additions here must be OPTIONAL (no `/v2`; absent = today).
 */
export const entryBodyFields = {
  foodId: t.Optional(t.String()),
  recipeId: t.Optional(t.String()),
  mealId: t.Optional(t.String()),
  mealSlot: t.Union([
    t.Literal("breakfast"),
    t.Literal("lunch"),
    t.Literal("snack"),
    t.Literal("dinner"),
  ]),
  // minimum: 0 — negative servings/macros would let a client subtract
  // kcal from their day (and trivially flip the streak). The DB has no
  // CHECK, so validate here. Review fix (PR #124).
  servings: t.Number({ minimum: 0 }),
  kcal: t.Optional(t.Number({ minimum: 0 })),
  proteinG: t.Optional(t.Number({ minimum: 0 })),
  carbsG: t.Optional(t.Number({ minimum: 0 })),
  fatG: t.Optional(t.Number({ minimum: 0 })),
  loggedAt: t.String(),
  // Client-supplied label for one-off/AI entries — stored/returned
  // verbatim, never derived or validated against a food (BRIEF).
  customName: t.Optional(t.String({ maxLength: 200 })),
  // Set by the AI photo / free-text confirm flow so AI-estimated rows
  // can be told apart from manual ones (accuracy review, M9.5).
  aiEstimated: t.Optional(t.Boolean()),
  aiConfidence: t.Optional(t.Number({ minimum: 0, maximum: 1 })),
  // Design D: the Your-meals meal this entry goes into. Must be the caller's.
  // When given, the server sets `mealSlot` from that meal's `logSlot`.
  userMealId: t.Optional(t.String()),
};

/** The single-create body schema (`POST /nutrition/entries`). */
export const entryBodySchema = t.Object(entryBodyFields);
export type EntryBody = Static<typeof entryBodySchema> & {
  sourcePlanId?: string | null;
  sourcePlanMealId?: string | null;
};

export type EntryRepos = {
  FoodRepository: Pick<FoodRepository, "getById">;
  RecipeRepository: Pick<RecipeRepository, "getById">;
  MealRepository: Pick<MealRepository, "getById">;
  UserMealRepository: Pick<UserMealRepository, "getOwned">;
};

export type EntryError =
  | "food_not_found"
  | "recipe_not_found"
  | "meal_not_found"
  | "user_meal_not_found"
  | "macros_required_for_custom_entry"
  | "invalid_logged_at";

/**
 * A `loggedAt` that Postgres can store as a timestamptz. `t.String()` lets
 * anything through, and `new Date("garbage")` (or a year outside Postgres's
 * range) used to throw inside the insert: a 500 that a re-send hits again
 * every time. The bounds are generous; they only exclude the unstorable.
 */
export function isStorableLoggedAt(value: string): boolean {
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return false;
  const year = new Date(ms).getUTCFullYear();
  return year >= 1900 && year <= 9999;
}

export type ResolveEntryResult =
  | { ok: true; input: CreateEntryInput }
  | { ok: false; error: EntryError };

/**
 * Turn a request body into a repository insert, scoped to `userId`.
 *
 * Macro authority: the server RE-DERIVES macros from the referenced row ×
 * servings and never trusts client math (BACKEND_BRIEF § 2):
 * - `foodId` → the food's per-serving macros × `servings`.
 * - `recipeId` → the recipe's PER-SERVING macros (`total_* / recipe.servings`)
 *   × `servings`. A recipe stores whole-recipe totals, so logging N servings
 *   is N portions of the dish, not N whole recipes.
 * - `mealId` → the meal's total (a meal preset is itself one serving) ×
 *   `servings`.
 * Only a true one-off (no reference) uses client-supplied macros.
 *
 * Every lookup is owner-scoped by `userId` (the JWT user): another user's
 * food, recipe, saved meal or Your-meals meal resolves to "not found".
 *
 * Every deterministic failure is a returned error, never a throw (Inspector
 * Brad, #542): a non-uuid reference — typically a `local-…` id for a food,
 * recipe or meal created offline that hasn't synced — is "not found" without a
 * query (Postgres would raise 22P02 on the uuid cast), and an unstorable
 * `loggedAt` is `invalid_logged_at`. A thrown error would 500 the whole batch
 * and recur on every re-send, stranding the entries after it. The 400 also
 * matches 1.2.0's sync drain, which treats a 4xx on a payload still carrying
 * a `local-…` id as deferred and retries it after the id swap.
 */
export async function resolveEntryInput(
  repos: EntryRepos,
  userId: string,
  body: EntryBody,
): Promise<ResolveEntryResult> {
  if (!isStorableLoggedAt(body.loggedAt)) {
    return { ok: false, error: "invalid_logged_at" };
  }

  // Only the reference the macros come from is stored: the first present of
  // food → recipe → meal, the same precedence as the derivation below. Any
  // other id sent beside it was never checked (format or ownership), so it is
  // dropped rather than stored — storing it let a stale id fail the insert
  // (a 500 on every re-send) and let another user's recipe id be stored
  // unchecked (Inspector Brad, #542). An empty string is no reference.
  const foodId = body.foodId || null;
  const recipeId = foodId === null ? body.recipeId || null : null;
  const mealId =
    foodId === null && recipeId === null ? body.mealId || null : null;

  let kcal = body.kcal;
  let proteinG = body.proteinG;
  let carbsG = body.carbsG;
  let fatG = body.fatG;

  if (foodId !== null) {
    const food = isUuid(foodId)
      ? await repos.FoodRepository.getById(foodId, userId)
      : null;
    if (!food) return { ok: false, error: "food_not_found" };
    kcal = food.kcal * body.servings;
    proteinG = food.proteinG * body.servings;
    carbsG = food.carbsG * body.servings;
    fatG = food.fatG * body.servings;
  } else if (recipeId !== null) {
    const recipe = isUuid(recipeId)
      ? await repos.RecipeRepository.getById(recipeId, userId)
      : null;
    if (!recipe) return { ok: false, error: "recipe_not_found" };
    // A 0/invalid servings count falls back to 1 to avoid divide-by-zero.
    const perServing = recipe.servings > 0 ? recipe.servings : 1;
    const factor = body.servings / perServing;
    kcal = (recipe.totalKcal ?? 0) * factor;
    proteinG = (recipe.totalProteinG ?? 0) * factor;
    carbsG = (recipe.totalCarbsG ?? 0) * factor;
    fatG = (recipe.totalFatG ?? 0) * factor;
  } else if (mealId !== null) {
    const meal = isUuid(mealId)
      ? await repos.MealRepository.getById(mealId, userId)
      : null;
    if (!meal) return { ok: false, error: "meal_not_found" };
    kcal = meal.totalKcal * body.servings;
    proteinG = meal.totalProteinG * body.servings;
    carbsG = meal.totalCarbsG * body.servings;
    fatG = meal.totalFatG * body.servings;
  }

  if (
    kcal === undefined ||
    proteinG === undefined ||
    carbsG === undefined ||
    fatG === undefined
  ) {
    return { ok: false, error: "macros_required_for_custom_entry" };
  }

  let mealSlot: MealSlot = body.mealSlot;
  let userMealId: string | null = null;
  if (body.userMealId !== undefined) {
    const userMeal = await repos.UserMealRepository.getOwned(
      userId,
      body.userMealId,
    );
    if (!userMeal) return { ok: false, error: "user_meal_not_found" };
    userMealId = userMeal.id;
    // `meal_slot` stays on every entry so older bundles still place it.
    mealSlot = userMeal.logSlot;
  }

  return {
    ok: true,
    input: {
      foodId,
      recipeId,
      mealId,
      mealSlot,
      servings: body.servings,
      kcal,
      proteinG,
      carbsG,
      fatG,
      loggedAt: body.loggedAt,
      customName: body.customName ?? null,
      // Provenance only (never affects macros). A confidence without the
      // AI flag is meaningless, so it is dropped rather than stored.
      aiEstimated: body.aiEstimated ?? false,
      aiConfidence: body.aiEstimated ? (body.aiConfidence ?? null) : null,
      userMealId,
      sourcePlanId: body.sourcePlanId ?? null,
      sourcePlanMealId: body.sourcePlanMealId ?? null,
    },
  };
}
