import Elysia, { t } from "elysia";
import { VolumeService } from "../repositories/volumeService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";
import { localDateISO } from "../streaks/period";
import {
  parseWindowKind,
  windowStartISO,
  DEFAULT_WORKOUTS_PER_WEEK,
} from "./window";
import {
  withMusclePct,
  adherencePct,
  daysBetweenInclusive,
} from "./volumeView";

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
      //
      // Guarded (Cluster 1a Task 2): a throw here used to 500 the WHOLE
      // request, disappearing the You-page card entirely even though
      // `workouts`/`totalKg` below are independently computable. Degrade
      // instead — log and keep serving the live totals with `byMuscle: []`
      // rather than skip the (freshly failing) by-muscle read and risk
      // silently serving a STALE materialised row.
      let recomputeFailed = false;
      try {
        await ctx.VolumeRepository.recomputeVolumeByMuscle(
          userId,
          tz,
          kind,
          start,
          end,
        );
      } catch (err) {
        recomputeFailed = true;
        console.error("[volume-stats] recompute failed, degrading to []", {
          userId,
          kind,
          error: err,
        });
      }

      const [workouts, totalKg, byMuscleRaw] = await Promise.all([
        ctx.VolumeRepository.completedSessionCount(userId, tz, start, end),
        ctx.VolumeRepository.totalVolume(userId, tz, start, end),
        recomputeFailed
          ? Promise.resolve([])
          : ctx.VolumeRepository.getVolumeByMuscle(userId, kind, start),
      ]);

      const adherence =
        kind === "lifetime"
          ? null
          : adherencePct(
              workouts,
              DEFAULT_WORKOUTS_PER_WEEK,
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
