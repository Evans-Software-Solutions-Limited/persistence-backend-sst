import Elysia, { t } from "elysia";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";
import { MealPlanService } from "../../../../repositories/mealPlanService";
import { NutritionEntryService } from "../../../../repositories/nutritionEntryService";

/**
 * POST /nutrition/plans/:id/meals/:mealId/log — log a planned meal to the food
 * diary (spec-26 AC 5.2). Deterministic, no AI, offline-queueable.
 *
 * ## Order is chosen for double-tap safety, not readability
 *
 * A planned meal → a `nutrition_entries` row → a link back
 * (`meal_plan_meals.logged_entry_id`) + a state flip. The hazard is a double tap
 * (or an offline queue replaying) creating TWO diary entries for one meal.
 *
 *   1. read the plan (ownership) + find the meal          → 404 if either misses
 *   2. already logged? return the existing link           → idempotent 200
 *   3. create the entry from the meal's DENORMALISED macros
 *   4. `markMealLogged` — atomically flips `planned`→`logged` (guarded
 *      `state <> 'logged'`). If it returns false, another request won the race
 *      between steps 1 and 4, so DELETE the entry just created and return the
 *      winner's link.
 *
 * Step 4 is the atomic gate; step 2 is only a cheap fast-path so the common
 * "already logged" case never creates an entry to roll back. The entry is
 * created BEFORE the flip because the flip needs its id — the compensating
 * delete on a lost race is the price of that ordering, and a lost race is rare.
 *
 * ⚠ **Ungated.** Logging a plan the user already generated is not gated for the
 * same reason reads are not — the paywall is on generation.
 */
export const nutritionPlanMealLogHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(MealPlanService)
  .use(NutritionEntryService)
  .post(
    "/nutrition/plans/:id/meals/:mealId/log",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const { id: planId, mealId } = ctx.params;

      const plan = await ctx.MealPlanRepository.get(userId, planId);
      if (!plan) {
        ctx.set.status = 404;
        return { error: "plan_not_found" };
      }
      const meal = plan.meals.find((entry) => entry.id === mealId);
      if (!meal) {
        ctx.set.status = 404;
        return { error: "meal_not_found" };
      }

      // 2. Fast-path idempotency. A meal already logged returns its existing
      //    link rather than creating a second entry — the shape a client that
      //    retried a succeeded request must see.
      if (meal.state === "logged" && meal.loggedEntryId) {
        return {
          data: {
            planMealId: meal.id,
            loggedEntryId: meal.loggedEntryId,
            alreadyLogged: true,
          },
        };
      }

      // 3. Create the entry from the meal's DENORMALISED macros — never
      //    recomputed here, because the plan already froze them at accept and the
      //    backing recipe/meal may since have changed. Provenance mirrors the
      //    meal's backing: a recipe/meal-backed meal carries its id; an item-list
      //    meal carries its label as the custom name so the diary row is legible.
      const entry = await ctx.NutritionEntryRepository.create(userId, {
        recipeId: meal.recipeId ?? null,
        mealId: meal.mealId ?? null,
        // ⚠ NOT the plan's item foodId(s): a plan meal can be several foods, and
        // `nutrition_entries` links a single food. The macros are the sum, so the
        // entry is a composed row identified by name, not by one food.
        foodId: null,
        customName:
          meal.recipeId || meal.mealId ? null : meal.label.slice(0, 200),
        mealSlot: meal.logSlot,
        servings: 1,
        kcal: meal.kcal,
        proteinG: meal.proteinG,
        carbsG: meal.carbsG,
        fatG: meal.fatG,
        // Noon UTC on the plan's date. The plan is for a calendar day, and noon
        // UTC lands on that day for every timezone from UTC-12 to UTC+12, so it
        // buckets correctly under `listByDate`'s user-local conversion without
        // needing the user's timezone here.
        loggedAt: `${plan.planDate}T12:00:00.000Z`,
      });

      // 4. Atomic flip. `markMealLogged` is guarded `state <> 'logged'`, so if a
      //    concurrent request logged this meal between our read and now, it
      //    returns false and we must not leave the duplicate entry behind.
      const linked = await ctx.MealPlanRepository.markMealLogged(
        userId,
        planId,
        mealId,
        entry.id,
      );

      if (!linked) {
        // Lost the race. Roll back our entry and return the winner's link.
        await ctx.NutritionEntryRepository.delete(entry.id, userId);
        const fresh = await ctx.MealPlanRepository.get(userId, planId);
        const winner = fresh?.meals.find((entry) => entry.id === mealId);
        return {
          data: {
            planMealId: mealId,
            loggedEntryId: winner?.loggedEntryId ?? null,
            alreadyLogged: true,
          },
        };
      }

      console.info(
        `[mealprint-plan-log] user=${userId} plan=${planId} meal=${mealId} entry=${entry.id}`,
      );
      return {
        data: {
          planMealId: mealId,
          loggedEntryId: entry.id,
          alreadyLogged: false,
        },
      };
    },
    {
      params: t.Object({
        id: t.String({ format: "uuid" }),
        mealId: t.String({ format: "uuid" }),
      }),
    },
  );
