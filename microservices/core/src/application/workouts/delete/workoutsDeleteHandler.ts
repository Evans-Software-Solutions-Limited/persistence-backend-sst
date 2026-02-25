import Elysia, { t } from "elysia";
import { WorkoutsDeleteService } from "./workoutsDeleteService";
import {
  supabaseAuth,
  type SupabaseUser,
} from "@persistence/api-utils/auth/supabaseAuth";

export const workoutsDeleteHandler = new Elysia()
  .use(supabaseAuth)
  .use(WorkoutsDeleteService)
  .delete(
    "/workouts/:id",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (ctx: any) => {
      const user = ctx.user as SupabaseUser;
      const userId = user.sub;
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
