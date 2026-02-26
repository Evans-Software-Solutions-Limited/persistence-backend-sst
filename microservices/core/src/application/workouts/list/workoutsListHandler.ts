import Elysia, { t } from "elysia";
import { WorkoutsListService } from "./workoutsListService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

export const workoutsListHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(WorkoutsListService)
  .get(
    "/workouts",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
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
