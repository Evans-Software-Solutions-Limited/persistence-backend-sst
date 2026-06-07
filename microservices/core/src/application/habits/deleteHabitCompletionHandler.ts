import Elysia, { t } from "elysia";
import { HabitService } from "../repositories/habitService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

/**
 * DELETE /habit-completions?goalId=&date= — toggle a habit OFF for a
 * user-local day (STORY-004 tap-to-untoggle). Idempotent: deleting a
 * non-existent completion returns deleted=false without erroring, so the sync
 * queue can replay safely. Streak reversal is left to the nightly cron's
 * reconcile (engine is advance-only on-write; server-wins per design.md).
 */
export const deleteHabitCompletionHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(HabitService)
  .delete(
    "/habit-completions",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const { goalId, date } = ctx.query;
      const completedAt = date ? new Date(date) : new Date();

      const deleted = await ctx.HabitRepository.remove(
        userId,
        goalId,
        completedAt,
      );
      return { data: { deleted } };
    },
    {
      query: t.Object({
        goalId: t.String(),
        date: t.Optional(t.String()),
      }),
    },
  );
