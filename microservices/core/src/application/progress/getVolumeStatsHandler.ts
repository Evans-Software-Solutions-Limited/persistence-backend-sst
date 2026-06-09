import Elysia, { t } from "elysia";
import { VolumeService } from "../repositories/volumeService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";
import { localDateISO } from "../streaks/period";
import { parseWindowKind, windowStartISO } from "./window";
import {
  withMusclePct,
  adherencePct,
  daysBetweenInclusive,
} from "./volumeView";

/** Default weekly target used for the adherence % until goal wiring lands. */
const WEEKLY_TARGET_DEFAULT = 4;

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
  .get(
    "/users/me/volume-stats",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const tz = await ctx.VolumeRepository.getUserTimezone(userId);
      const now = new Date();

      const kind = parseWindowKind(ctx.query.window);
      const start = windowStartISO(now, kind, tz);
      const end = localDateISO(now, tz);

      // Recompute the requested window's by-muscle materialisation on every
      // read. `workouts`/`totalKg` below are computed live from the source
      // tables, so a stale materialised row would visibly disagree with the
      // headline — and the cron only refreshes `month` (Inspector finding:
      // quarter/year/lifetime would never update after their first cold write).
      // This is the low-frequency You/Progress path, so a recompute-on-read
      // (a small delete+insert of per-muscle rows) is cheap + always consistent.
      await ctx.VolumeRepository.recomputeVolumeByMuscle(
        userId,
        tz,
        kind,
        start,
      );

      const [workouts, totalKg, byMuscleRaw] = await Promise.all([
        ctx.VolumeRepository.completedSessionCount(userId, tz, start, end),
        ctx.VolumeRepository.totalVolume(userId, tz, start, end),
        ctx.VolumeRepository.getVolumeByMuscle(userId, kind, start),
      ]);

      const adherence =
        kind === "lifetime"
          ? null
          : adherencePct(
              workouts,
              WEEKLY_TARGET_DEFAULT,
              daysBetweenInclusive(start, end),
            );

      return {
        data: {
          window: kind,
          workouts,
          totalKg,
          totalTonnes: Math.round(totalKg / 100) / 10,
          adherencePct: adherence,
          byMuscle: withMusclePct(byMuscleRaw),
        },
      };
    },
    {
      query: t.Object({ window: t.Optional(t.String()) }),
    },
  );
