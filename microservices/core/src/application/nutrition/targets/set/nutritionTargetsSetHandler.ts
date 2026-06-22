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
        dailyKcal: t.Number(),
        proteinG: t.Number(),
        carbsG: t.Number(),
        fatG: t.Number(),
        waterCups: t.Integer(),
        preset: t.Optional(t.String()),
      }),
    },
  );
