import Elysia, { t } from "elysia";
import {
  getAuthUser,
  getUser,
  requireAuth,
} from "@persistence/api-utils/auth/supabaseAuth";
import { ExercisePerformanceService } from "../../repositories/exercisePerformanceService";

/** Current-user performance metrics for one exercise. */
export const exercisesPerformanceSummaryHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(ExercisePerformanceService)
  .get(
    "/exercises/:id/performance-summary",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      return {
        data: await ctx.ExercisePerformanceRepository.getSummary(
          userId,
          ctx.params.id,
        ),
      };
    },
    { params: t.Object({ id: t.String({ format: "uuid" }) }) },
  );
