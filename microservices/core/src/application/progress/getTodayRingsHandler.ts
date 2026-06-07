import Elysia from "elysia";
import { VolumeService } from "../repositories/volumeService";
import { HomeReadService } from "../repositories/homeReadService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";
import { loadRings } from "./loadRings";

/**
 * GET /users/me/today-rings — the standalone Move/Train/Fuel ring data
 * (STORY-001). Fuel is "gated" until M9. See loadRings for the composition.
 */
export const getTodayRingsHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(VolumeService)
  .use(HomeReadService)
  .get("/users/me/today-rings", async (ctx) => {
    const { sub: userId } = getUser(ctx);
    const rings = await loadRings(
      {
        getUserTimezone: (u) => ctx.VolumeRepository.getUserTimezone(u),
        totalVolume: (u, tz, s, e) =>
          ctx.VolumeRepository.totalVolume(u, tz, s, e),
        getTodaySteps: (u, d) => ctx.HomeReadRepository.getTodaySteps(u, d),
      },
      userId,
      new Date(),
    );
    return { data: rings };
  });
