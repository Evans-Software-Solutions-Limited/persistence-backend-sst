import Elysia from "elysia";
import { DashboardService } from "../repositories/dashboardService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

export const dashboardHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(DashboardService)
  .get("/dashboard", async (ctx) => {
    const { sub: userId } = getUser(ctx);
    const dashboard = await ctx.DashboardRepository.getDashboard(userId);
    return { data: dashboard };
  });
