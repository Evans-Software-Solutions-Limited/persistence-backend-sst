import Elysia, { t } from "elysia";
import { WorkoutsGetService } from "./workoutsGetService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

export const workoutsGetHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(WorkoutsGetService)
  .get(
    "/workouts/:id",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const { id } = ctx.params;

      const workout = await ctx.WorkoutRepository.getById(id, userId);

      if (!workout) {
        ctx.set.status = 404;
        return { error: "Workout not found" };
      }

      return { data: workout };
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    },
  );
