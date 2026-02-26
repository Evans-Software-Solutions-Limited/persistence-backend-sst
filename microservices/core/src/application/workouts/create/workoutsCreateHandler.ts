import Elysia, { t } from "elysia";
import { WorkoutsCreateService } from "./workoutsCreateService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

export const workoutsCreateHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(WorkoutsCreateService)
  .post(
    "/workouts",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const { name, description, visibility, estimatedDurationMinutes } =
        ctx.body;

      if (!name || name.trim().length === 0) {
        ctx.set.status = 400;
        return { error: "Workout name is required" };
      }

      const workout = await ctx.WorkoutRepository.create(userId, {
        name,
        description: description || null,
        visibility: visibility || "private",
        estimatedDurationMinutes: estimatedDurationMinutes || 30,
      });

      ctx.set.status = 201;
      return { data: workout };
    },
    {
      body: t.Object({
        name: t.String(),
        description: t.Optional(t.String()),
        visibility: t.Optional(
          t.Union([
            t.Literal("private"),
            t.Literal("friends"),
            t.Literal("public"),
          ]),
        ),
        estimatedDurationMinutes: t.Optional(t.Number()),
      }),
    },
  );
