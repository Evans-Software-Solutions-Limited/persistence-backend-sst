import Elysia, { t } from "elysia";
import { ExerciseService } from "../../repositories/exerciseService";
import { getAuthUser } from "@persistence/api-utils/auth/supabaseAuth";

/**
 * GET /exercises/:id — single-exercise detail scoped by visibility.
 *
 * Spec: design.md § GET /exercises/:id · AC 7.8
 * - Auth optional; unauth callers see only system exercises
 * - Invisible row → 404 (no existence leak)
 */
export const exercisesGetHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .use(ExerciseService)
  .get(
    "/exercises/:id",
    async (ctx) => {
      const userId = ctx.user?.sub ?? null;
      const { id } = ctx.params;

      const exercise = await ctx.ExerciseRepository.getById(id, userId);

      if (!exercise) {
        ctx.set.status = 404;
        return { error: "Exercise not found" };
      }

      return { data: exercise };
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    },
  );
