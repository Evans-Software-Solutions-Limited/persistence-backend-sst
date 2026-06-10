import Elysia, { t } from "elysia";
import { HabitService } from "../repositories/habitService";
import { StreakReadService } from "../repositories/streakReadService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";
import { resolveEventTs } from "../streaks/evaluate";
import { parseHabitDay } from "./habitDay";

/**
 * DELETE /habit-completions?goalId=&date= — toggle a habit OFF for a
 * user-local day (STORY-004 tap-to-untoggle). Idempotent: deleting a
 * non-existent completion returns deleted=false without erroring, so the sync
 * queue can replay safely. `date` follows the same contract as POST: a
 * date-only string is the authoritative user-local day; a full timestamp is
 * converted via profiles.timezone.
 *
 * Streak reversal: when the deleted completion was the one that satisfied the
 * streak's MOST RECENT counted period (and nothing else still satisfies it),
 * the advance is conditionally rolled back via
 * StreakRepository.rollbackHabitAdvance — without this, tap-untap left a
 * permanently advanced streak with an empty grid behind it (Inspector
 * finding, PR #116; the previous comment claiming "the nightly cron
 * reconciles" was wrong — the cron never re-checks satisfied periods).
 */
export const deleteHabitCompletionHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(HabitService)
  .use(StreakReadService)
  .delete(
    "/habit-completions",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const { goalId, date } = ctx.query;

      const day = parseHabitDay(date);
      if (day.kind === "invalid") {
        ctx.set.status = 400;
        return { error: "Invalid date" };
      }

      // Clamp future instants to now — mirrors the create path so the lookup
      // key matches what create actually stored.
      const completedAt =
        day.kind === "day"
          ? resolveEventTs(`${day.localDate}T12:00:00.000Z`)
          : resolveEventTs(date);

      const deletedDay = await ctx.HabitRepository.remove(
        userId,
        goalId,
        completedAt,
        day.kind === "day" ? day.localDate : undefined,
      );

      // Conditional streak rollback — no-op unless this delete emptied the
      // streak's most recently counted period.
      if (deletedDay) {
        await ctx.StreakRepository.rollbackHabitAdvance(
          userId,
          goalId,
          deletedDay,
        );
      }

      return { data: { deleted: deletedDay !== null } };
    },
    {
      query: t.Object({
        goalId: t.String(),
        date: t.Optional(t.String()),
      }),
    },
  );
