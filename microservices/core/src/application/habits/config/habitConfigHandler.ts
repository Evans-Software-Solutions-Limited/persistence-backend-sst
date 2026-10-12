import Elysia, { t } from "elysia";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";
import { HabitConfigService } from "../../repositories/habitConfigService";
import { NutritionTargetService } from "../../repositories/nutritionTargetService";
import {
  isHabitCategory,
  resolveCalorieHabitTarget,
  validateHabitConfigInput,
} from "../habitCategories";
import { loadHabitConfig } from "./loadHabitConfig";

/**
 * Habit-setup config routes (18-habit-setup, Phase 18.2). Per design.md § 3.1.
 *
 *   GET    /users/me/habits/config          — all five categories (enabled or
 *                                              default), with coach-lock state
 *   PUT    /users/me/habits/:category/config — enable + configure (deferred
 *                                              edit when already active)
 *   DELETE /users/me/habits/:category        — disable (deferred to Monday)
 *
 * A coach-assigned habit is complete-only for the client: PUT/DELETE 403 while
 * the relationship is active (cross-cuts § 2.2). Bounds are enforced by
 * validateHabitConfigInput (422) — anti-gaming AC 8.5.
 */

export const habitConfigHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(HabitConfigService)
  .use(NutritionTargetService)
  .get("/users/me/habits/config", async (ctx) => {
    const { sub: userId } = getUser(ctx);
    return { data: await loadHabitConfig(ctx, userId) };
  })
  .put(
    "/users/me/habits/:category/config",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const { category } = ctx.params;
      if (!isHabitCategory(category)) {
        ctx.set.status = 404;
        return { error: "Unknown habit category" };
      }
      // Client can't retune a habit their coach owns (cross-cuts § 2.2).
      if (
        await ctx.HabitConfigRepository.isHabitCoachLocked(userId, category)
      ) {
        ctx.set.status = 403;
        return { error: "This habit is managed by your coach" };
      }
      // Calories: substitute the canonical Fuel-Targets value for the client's
      // (ignored) target so it can never drift from the nutrition target.
      const calorieOverride =
        category === "calories"
          ? resolveCalorieHabitTarget(
              (await ctx.NutritionTargetRepository.get(userId))?.dailyKcal,
            )
          : undefined;
      const validated = validateHabitConfigInput(
        category,
        {
          targetValue: ctx.body.targetValue,
          daysPerWeek: ctx.body.daysPerWeek,
          tolerancePct: ctx.body.tolerancePct,
        },
        calorieOverride,
      );
      if (!validated.ok) {
        ctx.set.status = 422;
        return { error: validated.error };
      }
      const view = await ctx.HabitConfigRepository.upsert(
        userId,
        category,
        validated.config,
      );
      if (!view) {
        ctx.set.status = 404;
        return { error: "Unknown habit category" };
      }
      return { data: view };
    },
    {
      params: t.Object({ category: t.String() }),
      body: t.Object({
        targetValue: t.Number(),
        daysPerWeek: t.Optional(t.Number()),
        tolerancePct: t.Optional(t.Number()),
      }),
    },
  )
  .delete(
    "/users/me/habits/:category",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const { category } = ctx.params;
      if (!isHabitCategory(category)) {
        ctx.set.status = 404;
        return { error: "Unknown habit category" };
      }
      if (
        await ctx.HabitConfigRepository.isHabitCoachLocked(userId, category)
      ) {
        ctx.set.status = 403;
        return { error: "This habit is managed by your coach" };
      }
      const disabledGoalId = await ctx.HabitConfigRepository.disable(
        userId,
        category,
      );
      if (!disabledGoalId) {
        ctx.set.status = 404;
        return { error: "Habit not enabled" };
      }
      return { data: { category, disabled: true } };
    },
    { params: t.Object({ category: t.String() }) },
  );
