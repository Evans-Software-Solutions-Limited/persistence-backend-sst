import Elysia, { t } from "elysia";
import {
  getAuthUser,
  getUser,
  requireAuth,
} from "@persistence/api-utils/auth/supabaseAuth";
import { ExercisePerformanceService } from "../../repositories/exercisePerformanceService";

export const exercisesEstimatedOneRepMaxHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(ExercisePerformanceService)
  .get(
    "/exercises/:exerciseId/estimated-1rm",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      return {
        data: await ctx.ExercisePerformanceRepository.getBestEstimatedOneRepMax(
          userId,
          ctx.params.exerciseId,
        ),
      };
    },
    { params: t.Object({ exerciseId: t.String({ minLength: 1 }) }) },
  );
