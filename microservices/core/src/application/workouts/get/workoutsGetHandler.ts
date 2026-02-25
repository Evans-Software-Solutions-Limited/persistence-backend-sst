import Elysia, { t } from "elysia";
import { WorkoutsGetService } from "./workoutsGetService";
import {
  supabaseAuth,
  type SupabaseUser,
} from "@persistence/api-utils/auth/supabaseAuth";

export const workoutsGetHandler = new Elysia()
  .use(supabaseAuth)
  .use(WorkoutsGetService)
  .get(
    "/workouts/:id",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (ctx: any) => {
      const user = ctx.user as SupabaseUser;
      const userId = user.sub;
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
