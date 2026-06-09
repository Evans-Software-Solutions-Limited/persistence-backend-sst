import Elysia, { t } from "elysia";
import { HabitService } from "../repositories/habitService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";
import { safeEvaluateStreaks, resolveEventTs } from "../streaks/evaluate";

/**
 * POST /habit-completions — mark a habit complete for a user-local day
 * (STORY-004 / STORY-007; cross-cuts § 3.3). Idempotent (unique UTC-day
 * index), so the mobile sync-queue replay is safe. Advances the habit_streak
 * fire-and-forget after the write commits.
 *
 * Body: { goalId, date? (ISO; defaults to now), value? }.
 */
export const createHabitCompletionHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(HabitService)
  .post(
    "/habit-completions",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const { goalId, date, value } = ctx.body;
      // Reject a malformed date with 400 rather than letting the downstream
      // `.toISOString()` throw a RangeError → 500 (Inspector finding).
      if (date !== undefined && Number.isNaN(new Date(date).getTime())) {
        ctx.set.status = 400;
        return { error: "Invalid date" };
      }
      // Clamp to now: past-day backfill (AC 4.5) passes through, but a
      // future date is pulled back so it can't push the habit_streak's
      // last_period_end into the future and grief the streak past every
      // genuinely-missed day (Inspector finding — same class fixed earlier in
      // the workout path). The CLAMPED value is what we both store + evaluate,
      // so we never persist a future-dated completion either.
      const completedAt = resolveEventTs(date);

      const completion = await ctx.HabitRepository.create(userId, {
        goalId,
        completedAt,
        value: value ?? null,
      });

      await safeEvaluateStreaks(userId, "habit_completed", completedAt);

      ctx.set.status = 201;
      return { data: completion };
    },
    {
      body: t.Object({
        goalId: t.String(),
        date: t.Optional(t.String()),
        value: t.Optional(t.Number()),
      }),
    },
  );
