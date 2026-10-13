import Elysia, { t } from "elysia";
import { VolumeService } from "../repositories/volumeService";
import { HabitConfigService } from "../repositories/habitConfigService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";
import { loadVolumeStats } from "./loadVolumeStats";

/**
 * GET /users/me/volume-stats?window=month — the You/Progress VolumeStats card
 * (STORY-003 AC 3.5): workouts, total volume (kg + tonnes), adherence %, and
 * the volume-by-muscle breakdown. Reads the materialised by-muscle table;
 * recomputes on a cold miss so the first post-deploy read still has data.
 */
export const getVolumeStatsHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(VolumeService)
  .use(HabitConfigService)
  .get(
    "/users/me/volume-stats",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      return { data: await loadVolumeStats(ctx, userId, ctx.query.window) };
    },
    {
      query: t.Object({ window: t.Optional(t.String()) }),
    },
  );
