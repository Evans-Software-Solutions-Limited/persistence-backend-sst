import Elysia, { t } from "elysia";
import { NutritionTargetService } from "../../../repositories/nutritionTargetService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

/**
 * PUT /nutrition/targets — self upsert of daily kcal/macros/water goal.
 * `set_by_user_id` is never written here (M8 trainer route owns it).
 */
export const nutritionTargetsSetHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(NutritionTargetService)
  .put(
    "/nutrition/targets",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const target = await ctx.NutritionTargetRepository.upsert(userId, {
        dailyKcal: ctx.body.dailyKcal,
        proteinG: ctx.body.proteinG,
        carbsG: ctx.body.carbsG,
        fatG: ctx.body.fatG,
        waterCups: ctx.body.waterCups,
        preset: ctx.body.preset,
      });
      return { data: target };
    },
    {
      body: t.Object({
        // minimum: 0 — targets can't be negative. Review fix (PR #124).
        dailyKcal: t.Number({ minimum: 0 }),
        proteinG: t.Number({ minimum: 0 }),
        carbsG: t.Number({ minimum: 0 }),
        fatG: t.Number({ minimum: 0 }),
        waterCups: t.Integer({ minimum: 0 }),
        preset: t.Optional(t.String()),
      }),
    },
  );
