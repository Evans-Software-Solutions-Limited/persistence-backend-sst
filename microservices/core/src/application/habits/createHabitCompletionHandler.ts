import Elysia, { t } from "elysia";
import { HabitService } from "../repositories/habitService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";
import { safeEvaluateStreaks, resolveEventTs } from "../streaks/evaluate";
import { parseHabitDay, latestLocalDateOnEarth } from "./habitDay";
import { validateCompletionValue } from "./habitCategories";
import {
  compareISO,
  periodEndForDateISO,
  periodStartFromEndISO,
} from "../streaks/period";

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

      // Per-category value validation (T-18.4.1 / design.md § 3.3). A
      // value_gte / within_tolerance habit REQUIRES a value in the category's
      // band; Gym (count) carries none (dropped to null). A goal that isn't a
      // configured habit (no habit_configs row) has no rule, so we skip value
      // validation and store whatever numeric value was sent (back-compat with
      // the pre-18 completion grid).
      const category = await ctx.HabitRepository.getHabitCategoryForGoal(
        userId,
        goalId,
      );
      let normalizedValue: number | null = value ?? null;
      if (category) {
        const valid = validateCompletionValue(category, value);
        if (!valid.ok) {
          ctx.set.status = 422;
          return { error: valid.error };
        }
        normalizedValue = valid.value;
      }

      // Prior-week rejection (anti-gaming AC 8.1): completions may only land
      // inside the CURRENT Mon–Sun week (up to today) — backfilling a closed
      // week would let a user inflate `longest`. `today` is the user-local day;
      // for a date-only cell we compare against the current week's Monday, for
      // an instant the derived local day is inherently now so it can't be
      // prior-week (still guarded once we know the day). Future days are already
      // rejected above (date-only) / clamped to now (instant).
      const todayLocal = await ctx.HabitRepository.userLocalDate(
        userId,
        new Date(),
      );
      const currentWeekStart = periodStartFromEndISO(
        periodEndForDateISO(todayLocal, "weekly"),
        "weekly",
      );
      if (
        day.kind === "day" &&
        compareISO(day.localDate, currentWeekStart) < 0
      ) {
        ctx.set.status = 422;
        return { error: "Cannot log a completion for a prior week" };
      }

      // For a date-only day, anchor the stored instant at noon UTC of that day
      // (clamped to now). Noon UTC keeps the instant inside the day for tz in
      // (-12, +12), but drifts to the next local day for tz ≥ +12 — so the
      // instant is NOT a reliable source for the user-local day. The
      // authoritative local day is carried separately via `localDate` (to the
      // dedup column AND to the streak engine), so the anchor only needs to be
      // a reasonable stored timestamp, not a tz-exact one.
      const completedAt =
        day.kind === "day"
          ? resolveEventTs(`${day.localDate}T12:00:00.000Z`)
          : resolveEventTs(date);
      const localDate = day.kind === "day" ? day.localDate : undefined;

      const completion = await ctx.HabitRepository.create(userId, {
        goalId,
        completedAt,
        localDate,
        value: normalizedValue,
      });

      // Pass the authoritative local day through so the engine evaluates the
      // period for the tapped cell, never the (possibly drifted) noon-UTC
      // instant (Inspector finding, PR #116).
      await safeEvaluateStreaks(
        userId,
        "habit_completed",
        completedAt,
        localDate,
      );

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
