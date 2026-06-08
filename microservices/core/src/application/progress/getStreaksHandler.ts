import Elysia from "elysia";
import { StreakReadService } from "../repositories/streakReadService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

/**
 * GET /users/me/streaks — the user's active streak rows for the You/Progress
 * StreakHero (06-progress-goals, STORY-003 AC 3.2). Drives current/longest/
 * freeze-token display + the "Use" button (which posts to .../use-token).
 */
export const getStreaksHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(StreakReadService)
  .get("/users/me/streaks", async (ctx) => {
    const { sub: userId } = getUser(ctx);
    const streaks = await ctx.StreakRepository.getActiveStreaksForUser(userId);
    return { data: streaks };
  });
