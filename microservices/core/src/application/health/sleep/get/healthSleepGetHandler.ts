import Elysia, { t } from "elysia";
import { SleepService } from "../../../repositories/sleepService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";
import { SLEEP_DATE_PATTERN, isValidCalendarDate } from "../sleepDate";

/**
 * GET /health/sleep?date=YYYY-MM-DD — the caller's most-authoritative sleep
 * record for that date (specs/20-sleep-quicklog STORY-002 AC 2.2, Decision
 * D3: most-recent by `created_at` across any data_source), or `{ sleep:
 * null }` when none exists.
 */
export const healthSleepGetHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(SleepService)
  .get(
    "/health/sleep",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      // Shape passed the typebox pattern; reject calendar-impossible dates.
      if (!isValidCalendarDate(ctx.query.date)) {
        ctx.set.status = 422;
        return { error: "date must be a valid YYYY-MM-DD calendar date" };
      }
      const sleep = await ctx.SleepRepository.getForDate(
        userId,
        ctx.query.date,
      );
      return { sleep };
    },
    {
      query: t.Object({ date: t.String({ pattern: SLEEP_DATE_PATTERN }) }),
    },
  );
