import Elysia, { t } from "elysia";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";
import { MealPlanService } from "../../../../repositories/mealPlanService";
import { MealprintCandidateService } from "../../../../repositories/mealprintCandidateService";
import { NutritionPreferenceService } from "../../../../repositories/nutritionPreferenceService";
import type {
  CreatePlanMealInput,
  LogSlot,
} from "../../../../repositories/mealPlanRepository";
import type { MealprintCandidate } from "../../../../repositories/mealprintCandidateRepository";
import { partitionByAvoidance } from "../../safety/avoidanceFilter";

/**
 * POST /nutrition/plans/:id/meals/:mealId/replace — persist ONE replacement
 * meal into an already-accepted plan (spec-26 Phase 2 post-accept edit).
 *
 * ## Same correctness model as accept, applied to a single meal
 *
 * The AI swap endpoint (`/nutrition/ai/plan-meal-swap`) regenerates a
 * candidate meal statelessly and hands it back to the client — it never
 * touches a saved plan. This route is the other half: the client picks a
 * meal (its own edit, or the AI swap's suggestion) and asks to persist it.
 * The request therefore carries REFERENCES ONLY — label, logSlot, an optional
 * recipeId/mealId/servings, an optional items[] of {foodId, servings}, an
 * optional aiReason — **never macros, never names**. Every kcal/protein/
 * carb/fat value written to `meal_plan_meals` is recomputed here from
 * `resolveByIds`, exactly as `nutritionPlansCreateHandler` does for a whole
 * plan. See that handler's docstring for the full "accuracy is a database
 * property" reasoning — it applies unchanged to a single-meal replace.
 *
 * ## Guard order
 *
 *   1. auth                                        → 401
 *   2. every referenced id resolves                → 400 `unresolvable_items`
 *   3. avoidance re-run on the resolved rows       → 422 `avoidance_violation`
 *   4. replace (ownership + existence arbitrated
 *      by the repository in one query)             → 404 `meal_not_found`
 *
 * ⚠ **No entitlement gate here, deliberately** — same reasoning as accept:
 * the paywall sits on GENERATION (`plan-generate` and `meal-suggest` are both
 * 402). Editing a meal in a plan the user already owns must keep working
 * after a subscription lapses.
 *
 * ⚠ **Step 2 resolves via the user-scoped `resolveByIds`.** This is the same
 * repository call the accept handler uses, and it is what closes the
 * private-food isolation leak: a food/recipe/meal owned by another user never
 * resolves for this caller, so it is reported as `unresolvable_items` rather
 * than silently readable. `replaceMeal` then re-scopes by `userId` again at
 * the write, so a plan/meal that belongs to someone else 404s even if every
 * id in the body happened to resolve (e.g. all public foods).
 */
export const nutritionPlanMealReplaceHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(MealPlanService)
  .use(MealprintCandidateService)
  .use(NutritionPreferenceService)
  .post(
    "/nutrition/plans/:id/meals/:mealId/replace",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const { id: planId, mealId } = ctx.params;
      const meal = ctx.body;

      const preferences = await ctx.NutritionPreferenceRepository.get(userId);

      // 2. Resolve every referenced id. Same shape as the accept handler,
      // scaled down to one meal.
      const foodIds = (meal.items ?? []).map((item) => item.foodId);
      const recipeIds = meal.recipeId ? [meal.recipeId] : [];
      const mealIds = meal.mealId ? [meal.mealId] : [];

      const resolved = await ctx.MealprintCandidateRepository.resolveByIds(
        userId,
        { foodIds, recipeIds, mealIds },
      );

      const byKindId = new Map<string, MealprintCandidate>(
        resolved.map((candidate) => [
          `${candidate.kind}:${candidate.id}`,
          candidate,
        ]),
      );

      const missing: string[] = [];
      if (meal.recipeId && !byKindId.has(`recipe:${meal.recipeId}`)) {
        missing.push(`recipe:${meal.recipeId}`);
      }
      if (meal.mealId && !byKindId.has(`meal:${meal.mealId}`)) {
        missing.push(`meal:${meal.mealId}`);
      }
      for (const item of meal.items ?? []) {
        if (!byKindId.has(`food:${item.foodId}`)) {
          missing.push(`food:${item.foodId}`);
        }
      }
      if (missing.length > 0) {
        console.warn(
          `[mealprint-plan-replace] unresolvable user=${userId} plan=${planId} meal=${mealId} ids=${missing.join(",")}`,
        );
        ctx.set.status = 400;
        return { error: "unresolvable_items", items: [...new Set(missing)] };
      }

      // 3. Avoidance re-run against the resolved rows — the replacement may
      // not have gone through the suggest/swap pipeline's own filter (a
      // hand-picked food, or preferences changed since a swap was generated).
      const { rejected } = partitionByAvoidance(resolved, preferences);
      if (rejected.length > 0) {
        console.warn(
          `[mealprint-plan-replace] avoidance user=${userId} plan=${planId} meal=${mealId} rejected=${rejected
            .map(
              (entry) =>
                `${entry.subject.kind}:${entry.subject.id}:${entry.verdict.rule}`,
            )
            .join(",")}`,
        );
        ctx.set.status = 422;
        return {
          error: "avoidance_violation",
          items: rejected.map((entry) => entry.subject.id),
        };
      }

      // Recompute — identical arithmetic to the accept handler: Σ candidate
      // macro × servings, with a recipe/meal-backed add using the per-serving
      // figure × servings, rounded to one decimal.
      let kcal = 0;
      let proteinG = 0;
      let carbsG = 0;
      let fatG = 0;

      const add = (candidate: MealprintCandidate, servings: number) => {
        kcal += candidate.kcal * servings;
        proteinG += candidate.proteinG * servings;
        carbsG += candidate.carbsG * servings;
        fatG += candidate.fatG * servings;
      };

      if (meal.recipeId) {
        add(byKindId.get(`recipe:${meal.recipeId}`)!, meal.servings ?? 1);
      }
      if (meal.mealId) {
        add(byKindId.get(`meal:${meal.mealId}`)!, meal.servings ?? 1);
      }
      for (const item of meal.items ?? []) {
        add(byKindId.get(`food:${item.foodId}`)!, item.servings);
      }

      const input: Omit<CreatePlanMealInput, "sortOrder"> = {
        label: meal.label,
        logSlot: meal.logSlot as LogSlot,
        recipeId: meal.recipeId ?? null,
        mealId: meal.mealId ?? null,
        items: meal.items ?? null,
        kcal: Math.round(kcal * 10) / 10,
        proteinG: Math.round(proteinG * 10) / 10,
        carbsG: Math.round(carbsG * 10) / 10,
        fatG: Math.round(fatG * 10) / 10,
        aiReason: meal.aiReason ?? null,
      };

      // 4. `replaceMeal` scopes by userId in its own query — this is the
      // second half of the isolation guard, not a redundant check: a plan or
      // meal that isn't this user's returns null even if every referenced id
      // above happened to resolve (e.g. all public foods).
      const plan = await ctx.MealPlanRepository.replaceMeal(
        userId,
        planId,
        mealId,
        input,
      );

      if (!plan) {
        ctx.set.status = 404;
        return { error: "meal_not_found" };
      }

      console.info(
        `[mealprint-plan-replace] user=${userId} plan=${planId} meal=${mealId}`,
      );
      return { data: plan };
    },
    {
      params: t.Object({
        id: t.String({ format: "uuid" }),
        mealId: t.String({ format: "uuid" }),
      }),
      body: t.Object({
        label: t.String({ minLength: 1, maxLength: 120 }),
        logSlot: t.Union([
          t.Literal("breakfast"),
          t.Literal("lunch"),
          t.Literal("snack"),
          t.Literal("dinner"),
        ]),
        recipeId: t.Optional(t.String({ format: "uuid" })),
        mealId: t.Optional(t.String({ format: "uuid" })),
        /** Multiplier for a recipe/meal-backed row. Items carry their own. */
        servings: t.Optional(t.Number({ minimum: 0.1, maximum: 20 })),
        items: t.Optional(
          t.Array(
            t.Object({
              foodId: t.String({ format: "uuid" }),
              servings: t.Number({ minimum: 0.1, maximum: 20 }),
            }),
            { maxItems: 30 },
          ),
        ),
        aiReason: t.Optional(t.String({ maxLength: 400 })),
        // ⚠ NOTE WHAT IS ABSENT: no kcal/proteinG/carbsG/fatG. Elysia strips
        // unknown properties — a client sending macros has them discarded
        // rather than honoured, mirroring the accept handler's schema exactly.
      }),
    },
  );
