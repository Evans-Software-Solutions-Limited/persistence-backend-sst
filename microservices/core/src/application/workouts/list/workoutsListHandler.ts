import Elysia, { t } from "elysia";
import { WorkoutsListService } from "./workoutsListService";
import {
  supabaseAuth,
  type SupabaseUser,
} from "@persistence/api-utils/auth/supabaseAuth";

export const workoutsListHandler = new Elysia()
  .use(supabaseAuth)
  .use(WorkoutsListService)
  .get(
    "/workouts",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (ctx: any) => {
      const user = ctx.user as SupabaseUser;
      const userId = user.sub;

      const { type, limit, offset } = ctx.query;

      const workouts = await ctx.WorkoutRepository.list(userId, {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        type: (type as any) || "mine",
        limit: limit ? parseInt(limit, 10) : 20,
        offset: offset ? parseInt(offset, 10) : 0,
      });

      return { data: workouts };
    },
    {
      query: t.Object({
        type: t.Optional(
          t.Union([
            t.Literal("mine"),
            t.Literal("assigned"),
            t.Literal("default"),
          ]),
        ),
        limit: t.Optional(t.String()),
        offset: t.Optional(t.String()),
      }),
    },
  );
