import Elysia, { t } from "elysia";
import { SleepService } from "../../../repositories/sleepService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";
import { SLEEP_DATE_PATTERN, isValidCalendarDate } from "../sleepDate";

/** Parses an optional ISO datetime string; drops it silently if unparsable
 * rather than 422ing on a best-effort HealthKit-mirrored field. */
function parseOptionalDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/**
 * POST /health/sleep — manual sleep quick-log (specs/20-sleep-quicklog
 * STORY-002 AC 2.1/2.4). Upserts the caller's `sleep_data` row for
 * `sleepDate` with `data_source = 'manual'` and returns the stored record.
 * Re-saving the same `sleepDate` overwrites (one manual row per user per
 * day) rather than duplicating.
 */
export const healthSleepPostHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(SleepService)
  .post(
    "/health/sleep",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const { sleepDate, durationMinutes, sleepStart, sleepEnd } = ctx.body;

      // Shape passed the typebox pattern; reject calendar-impossible dates
      // (e.g. 2026-13-45) with a 422 rather than letting the DATE column 500.
      if (!isValidCalendarDate(sleepDate)) {
        ctx.set.status = 422;
        return { error: "sleepDate must be a valid YYYY-MM-DD calendar date" };
      }

      const record = await ctx.SleepRepository.upsertManual(userId, {
        sleepDate,
        durationMinutes,
        sleepStart: parseOptionalDate(sleepStart),
        sleepEnd: parseOptionalDate(sleepEnd),
      });

      return { data: record };
    },
    {
      body: t.Object({
        sleepDate: t.String({ pattern: SLEEP_DATE_PATTERN }),
        // (0, 1440] — a valid day has at most 1440 minutes; 0 isn't a real log.
        durationMinutes: t.Integer({ minimum: 1, maximum: 1440 }),
        sleepStart: t.Optional(t.String()),
        sleepEnd: t.Optional(t.String()),
      }),
    },
  );
