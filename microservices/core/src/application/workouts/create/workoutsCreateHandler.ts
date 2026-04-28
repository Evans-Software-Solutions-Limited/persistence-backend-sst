import Elysia, { t } from "elysia";
import { WorkoutService } from "../../repositories/workoutService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

const workoutExerciseInputSchema = t.Object({
  exerciseId: t.String(),
  sortOrder: t.Number(),
  supersetGroup: t.Optional(t.Union([t.Number(), t.Null()])),
  targetSets: t.Optional(t.Union([t.Number(), t.Null()])),
  targetRepsMin: t.Optional(t.Number()),
  targetRepsMax: t.Optional(t.Number()),
  targetDurationSeconds: t.Optional(t.Union([t.Number(), t.Null()])),
  restSeconds: t.Optional(t.Union([t.Number(), t.Null()])),
  notes: t.Optional(t.Union([t.String(), t.Null()])),
});

export const workoutsCreateHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(WorkoutService)
  .post(
    "/workouts",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const {
        name,
        description,
        visibility,
        estimatedDurationMinutes,
        exercises,
      } = ctx.body;

      if (!name || name.trim().length === 0) {
        ctx.set.status = 400;
        return { error: "Workout name is required" };
      }

      if (exercises) {
        for (const ex of exercises) {
          if (
            ex.targetRepsMin !== undefined &&
            ex.targetRepsMax !== undefined &&
            ex.targetRepsMin > ex.targetRepsMax
          ) {
            ctx.set.status = 400;
            return {
              error:
                "targetRepsMin cannot exceed targetRepsMax for any exercise",
            };
          }
        }
      }

      const workout = await ctx.WorkoutRepository.createWithExercises(userId, {
        name,
        description: description ?? null,
        visibility: visibility ?? "private",
        estimatedDurationMinutes: estimatedDurationMinutes ?? 30,
        exercises: exercises ?? [],
      });

      ctx.set.status = 201;
      return { data: workout };
    },
    {
      body: t.Object({
        name: t.String(),
        description: t.Optional(t.Union([t.String(), t.Null()])),
        visibility: t.Optional(
          t.Union([
            t.Literal("private"),
            t.Literal("friends"),
            t.Literal("public"),
          ]),
        ),
        estimatedDurationMinutes: t.Optional(t.Number()),
        exercises: t.Optional(t.Array(workoutExerciseInputSchema)),
      }),
    },
  );
