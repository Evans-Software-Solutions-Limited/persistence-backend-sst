import Elysia, { t } from "elysia";
import { WaterLogService } from "../../../repositories/waterLogService";
import { NutritionTargetService } from "../../../repositories/nutritionTargetService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

const DEFAULT_WATER_GOAL = 8;

/**
 * PATCH /nutrition/water/today — set the day's cups.
 * `cups` is the authoritative absolute set (idempotent offline replay,
 * BACKEND_BRIEF § 4); `delta` is a +/- convenience for the live UI. At least
 * one must be supplied.
 */
export const nutritionWaterPatchHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(WaterLogService)
  .use(NutritionTargetService)
  .patch(
    "/nutrition/water/today",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const { date, cups, delta } = ctx.body;

      let next: number;
      if (cups !== undefined) {
        next = await ctx.WaterLogRepository.setCups(userId, date, cups);
      } else if (delta !== undefined) {
        next = await ctx.WaterLogRepository.adjust(userId, date, delta);
      } else {
        ctx.set.status = 400;
        return { error: "cups_or_delta_required" };
      }

      const target = await ctx.NutritionTargetRepository.get(userId);
      return {
        data: { cups: next, goal: target?.waterCups ?? DEFAULT_WATER_GOAL },
      };
    },
    {
      body: t.Object({
        date: t.String(),
        cups: t.Optional(t.Integer()),
        delta: t.Optional(t.Integer()),
      }),
    },
  );
