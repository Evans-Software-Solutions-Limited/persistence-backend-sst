import Elysia from "elysia";
import { HomeReadService } from "../repositories/homeReadService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

/**
 * GET /users/me/achievements — all unlocked achievements joined to their lookup
 * metadata (STORY-003 milestones row + the drawer count). Newest-first.
 */
export const getAchievementsHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(HomeReadService)
  .get("/users/me/achievements", async (ctx) => {
    const { sub: userId } = getUser(ctx);
    const achievements = await ctx.HomeReadRepository.getAchievements(userId);
    return { data: achievements };
  });
