import Elysia, { t } from "elysia";
import { WorkoutsDeleteService } from "./workoutsDeleteService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

export const workoutsDeleteHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(WorkoutsDeleteService)
  .delete(
    "/workouts/:id",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const { id } = ctx.params;

      const success = await ctx.WorkoutRepository.delete(id, userId);

      if (!success) {
        ctx.set.status = 403;
        return {
          error: "Unauthorized: you can only delete your own workouts",
        };
      }

      ctx.set.status = 204;
      return null;
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    },
  );
