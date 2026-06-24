import Elysia, { t } from "elysia";
import { WaterLogService } from "../../../repositories/waterLogService";
import { NutritionTargetService } from "../../../repositories/nutritionTargetService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

const DEFAULT_WATER_GOAL = 8;

/** GET /nutrition/water/today?date=YYYY-MM-DD — cups logged + the goal. */
export const nutritionWaterGetHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(WaterLogService)
  .use(NutritionTargetService)
  .get(
    "/nutrition/water/today",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const cups = await ctx.WaterLogRepository.getCups(userId, ctx.query.date);
      const target = await ctx.NutritionTargetRepository.get(userId);
      return {
        data: { cups, goal: target?.waterCups ?? DEFAULT_WATER_GOAL },
      };
    },
    {
      query: t.Object({ date: t.String() }),
    },
  );
