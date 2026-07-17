import Elysia from "elysia";
import { DashboardService } from "../repositories/dashboardService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

export type {
  DashboardData,
  DashboardProfile,
  DashboardSubscription,
  DashboardRecentWorkout,
  DashboardRecentActivity,
  DashboardProgress,
  DashboardPROfTheWeek,
  DashboardLatestMeasurement,
  SubscriptionStatus,
  RecordType,
  AssignedByType,
} from "../repositories/dashboardRepository";

/**
 * GET /dashboard — single-envelope aggregation endpoint powering the Home tab.
 *
 * Response shape: { data: DashboardPayload } — a *single* data wrapper.
 * Do NOT double-envelope; `DashboardPayload` is an object, not a paginated list.
 *
 * Spec: specs/06-progress-goals/design.md § Dashboard backend contract (M1).
 */
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
