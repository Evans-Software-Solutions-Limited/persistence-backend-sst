import Elysia, { t } from "elysia";
import { WorkoutService } from "../../repositories/workoutService";
import type { UpdateWorkoutInput } from "../../repositories/workoutRepository";
import {
  findInvalidRepRangeIndex,
  workoutExerciseInputSchema,
} from "../shared/schemas";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

export const workoutsUpdateHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(WorkoutService)
  .patch(
    "/workouts/:id",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const { id } = ctx.params;
      const {
        name,
        description,
        visibility,
        estimatedDurationMinutes,
        exercises,
      } = ctx.body;

      if (name !== undefined && name.trim().length === 0) {
        ctx.set.status = 400;
        return { error: "Workout name cannot be empty" };
      }

      if (exercises) {
        const badIndex = findInvalidRepRangeIndex(exercises);
        if (badIndex !== null) {
          ctx.set.status = 400;
          return {
            error: "targetRepsMin cannot exceed targetRepsMax for any exercise",
          };
        }
      }

      const updateData: UpdateWorkoutInput = {};
      if (name !== undefined) updateData.name = name;
      if (description !== undefined) updateData.description = description;
      if (visibility !== undefined) updateData.visibility = visibility;
      if (estimatedDurationMinutes !== undefined)
        updateData.estimatedDurationMinutes = estimatedDurationMinutes;
      if (exercises !== undefined) updateData.exercises = exercises;

      const workout = await ctx.WorkoutRepository.update(
        id,
        userId,
        updateData,
      );

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
      body: t.Object({
        name: t.Optional(t.String()),
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
