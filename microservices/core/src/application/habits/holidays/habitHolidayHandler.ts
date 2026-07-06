import Elysia, { t } from "elysia";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";
import { HabitHolidayService } from "../../repositories/habitHolidayService";

/**
 * Streak-holiday routes (18-habit-setup, Phase 18.2 — T-18.2.4). Per design.md
 * § 3.1 + § 6. These are the "planned pause for all habits" endpoints; the UI
 * that drives them lives on HOME (locked decision 11), not the setup screen —
 * they live here for cohesion.
 *
 *   GET    /users/me/habits/holidays        — list the user's holidays
 *   POST   /users/me/habits/holidays        — declare (≥24 h-advance 422)
 *   DELETE /users/me/habits/holidays/:id     — end early (truncate) / cancel /
 *                                              409 if wholly past
 *
 * Dates are YYYY-MM-DD user-local calendar strings (the client already renders
 * in the user's timezone). The 24 h-advance + truncate rules are enforced in
 * the repository (anti-gaming AC 8.3).
 */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const habitHolidayHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(HabitHolidayService)
  .get("/users/me/habits/holidays", async (ctx) => {
    const { sub: userId } = getUser(ctx);
    const data = await ctx.HabitHolidayRepository.listForUser(userId);
    return { data };
  })
  .post(
    "/users/me/habits/holidays",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const { startDate, endDate } = ctx.body;
      if (!ISO_DATE.test(startDate) || !ISO_DATE.test(endDate)) {
        ctx.set.status = 422;
        return { error: "startDate and endDate must be YYYY-MM-DD dates" };
      }
      const result = await ctx.HabitHolidayRepository.declare(
        userId,
        startDate,
        endDate,
      );
      if (!result.ok) {
        ctx.set.status = result.status;
        return { error: result.error };
      }
      ctx.set.status = 201;
      return { data: result.holiday };
    },
    {
      body: t.Object({
        startDate: t.String(),
        endDate: t.String(),
      }),
    },
  )
  .delete(
    "/users/me/habits/holidays/:id",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const result = await ctx.HabitHolidayRepository.endEarly(
        userId,
        ctx.params.id,
      );
      if (!result.ok) {
        ctx.set.status = result.status;
        return { error: result.error };
      }
      return {
        data: { action: result.action, holiday: result.holiday },
      };
    },
    { params: t.Object({ id: t.String() }) },
  );
