import Elysia, { t } from "elysia";
import { StreakReadService } from "../repositories/streakReadService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

/**
 * POST /users/me/streaks/:id/use-token — manual freeze-token spend (STORY-003
 * AC 3.2/3.4). Two modes on the same route:
 *
 *  - default (`mode` omitted / "retroactive"): protect a streak that has ALREADY
 *    fallen behind — spend one token per missed period, fast-forward
 *    last_period_end (existing `spendTokenManually`, 06.5 "Use" button).
 *  - `mode: "skip"` (18-habit-setup T-18.5.4): proactively "skip this week" —
 *    spend ONE token to cover the CURRENT in-progress period so it can't break
 *    at rollover, advancing last_period_end over the current period with NO
 *    count change (`skipCurrentPeriod`).
 *
 * Ownership + the balance / behind-or-ahead guards are folded into the repo's
 * conditional UPDATE, so an invalid spend returns 400 without leaking existence.
 */
export const useFreezeTokenHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(StreakReadService)
  .post(
    "/users/me/streaks/:id/use-token",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const mode = ctx.body?.mode ?? "retroactive";
      const updated =
        mode === "skip"
          ? await ctx.StreakRepository.skipCurrentPeriod(userId, ctx.params.id)
          : await ctx.StreakRepository.spendTokenManually(
              userId,
              ctx.params.id,
            );
      if (!updated) {
        ctx.set.status = 400;
        return { error: "No freeze token available for this streak" };
      }
      return { data: updated };
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Optional(
        t.Object({
          mode: t.Optional(
            t.Union([t.Literal("retroactive"), t.Literal("skip")]),
          ),
        }),
      ),
    },
  );
