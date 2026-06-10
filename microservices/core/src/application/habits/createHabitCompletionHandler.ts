import Elysia, { t } from "elysia";
import { HabitService } from "../repositories/habitService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";
import { safeEvaluateStreaks, resolveEventTs } from "../streaks/evaluate";
import { parseHabitDay, latestLocalDateOnEarth } from "./habitDay";

/**
 * POST /habit-completions — mark a habit complete for a user-local day
 * (STORY-004 / STORY-007; cross-cuts § 3.3). Idempotent (unique
 * user-local-day index), so the mobile sync-queue replay is safe. Advances
 * the habit_streak fire-and-forget after the write commits.
 *
 * Body: { goalId, date?, value? }. `date` accepts either:
 *  - a date-only string ("2026-06-04") — AUTHORITATIVE user-local day (the
 *    tapped grid cell). Converting it via an instant would shift it a day for
 *    any user west of UTC (Inspector finding, PR #116), so it is passed
 *    through to the dedup column verbatim;
 *  - a full ISO timestamp — converted to the user-local day from
 *    profiles.timezone (clamped to now; future-grief guard);
 *  - omitted — defaults to now.
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

      const day = parseHabitDay(date);
      if (day.kind === "invalid") {
        ctx.set.status = 400;
        return { error: "Invalid date" };
      }
      // A date-only cell can never legitimately be later than the latest
      // "today" anywhere on Earth (UTC+14) — reject instead of silently
      // recording a future local day the dedup index would then block.
      if (day.kind === "day" && day.localDate > latestLocalDateOnEarth()) {
        ctx.set.status = 400;
        return { error: "Date is in the future" };
      }

      // Ownership: the FK only proves the goal EXISTS — without this check
      // any authenticated user could log completions against another user's
      // goal UUID (Inspector finding, PR #116). 404, not 403 — don't leak
      // goal existence.
      const owned = await ctx.HabitRepository.goalBelongsToUser(userId, goalId);
      if (!owned) {
        ctx.set.status = 404;
        return { error: "Goal not found" };
      }

      // For a date-only day, anchor the stored instant at noon UTC of that
      // day (clamped to now) — inside the day for every tz in (-12, +12);
      // the authoritative local day is carried separately via `localDate`.
      const completedAt =
        day.kind === "day"
          ? resolveEventTs(`${day.localDate}T12:00:00.000Z`)
          : resolveEventTs(date);

      const completion = await ctx.HabitRepository.create(userId, {
        goalId,
        completedAt,
        localDate: day.kind === "day" ? day.localDate : undefined,
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
