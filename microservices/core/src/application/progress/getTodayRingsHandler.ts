import Elysia from "elysia";
import { VolumeService } from "../repositories/volumeService";
import { HomeReadService } from "../repositories/homeReadService";
import { NutritionEntryService } from "../repositories/nutritionEntryService";
import { NutritionTargetService } from "../repositories/nutritionTargetService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";
import { loadRings } from "./loadRings";

/**
 * GET /users/me/today-rings — the standalone Move/Train/Fuel ring data
 * (STORY-001). Fuel is live once the user has a daily kcal target (M9);
 * otherwise gated. See loadRings for the composition.
 */
export const getTodayRingsHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(VolumeService)
  .use(HomeReadService)
  .use(NutritionEntryService)
  .use(NutritionTargetService)
  .get("/users/me/today-rings", async (ctx) => {
    const { sub: userId } = getUser(ctx);
    const rings = await loadRings(
      {
        getUserTimezone: (u) => ctx.VolumeRepository.getUserTimezone(u),
        totalVolume: (u, tz, s, e) =>
          ctx.VolumeRepository.totalVolume(u, tz, s, e),
        getTodaySteps: (u, d) => ctx.HomeReadRepository.getTodaySteps(u, d),
        sumKcalForDay: (u, d) =>
          ctx.NutritionEntryRepository.sumKcalForDay(u, d),
        getDailyKcalTarget: async (u) =>
          (await ctx.NutritionTargetRepository.get(u))?.dailyKcal ?? null,
      },
      userId,
      new Date(),
    );
    return { data: rings };
  });
