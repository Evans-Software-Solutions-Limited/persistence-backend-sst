import Elysia, { t } from "elysia";
import { StreakReadService } from "../repositories/streakReadService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

/**
 * POST /users/me/streaks/:id/use-token — manual freeze-token spend (STORY-003
 * AC 3.2, the "Use" button). Ownership + the >0-balance guard are folded into
 * the UPDATE WHERE, so a wrong-user or empty-balance spend returns 400 without
 * leaking existence.
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
      const updated = await ctx.StreakRepository.spendTokenManually(
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
    },
  );
