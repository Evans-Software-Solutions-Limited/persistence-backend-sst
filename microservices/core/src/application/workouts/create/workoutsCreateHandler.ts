import Elysia, { t } from "elysia";
import { WorkoutService } from "../../repositories/workoutService";
import {
  findInvalidRepRangeIndex,
  workoutExerciseInputSchema,
} from "../shared/schemas";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";
import {
  assertEntitlement,
  EntitlementError,
} from "../../entitlement/assertEntitlement";

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
        const badIndex = findInvalidRepRangeIndex(exercises);
        if (badIndex !== null) {
          ctx.set.status = 400;
          return {
            error: "targetRepsMin cannot exceed targetRepsMax for any exercise",
          };
        }
      }

      // Server-side entitlement gate (M10.5). Reads live DB — never
      // trusts JWT claims, so a user with a still-valid JWT but a
      // cancelled / expired / over-limit sub is blocked here. Throwing
      // EntitlementError surfaces as HTTP 402 via coreErrorHandler with
      // a structured body the mobile feature-gate adapter parses
      // verbatim (see shared/errorHandler.ts).
      //
      // Position: AFTER input validation (so an invalid payload still
      // returns the more informative 400 / 422), BEFORE
      // createWithExercises (so we never insert a workout the user
      // isn't entitled to — including avoiding the workout-count
      // increment trigger firing on a denied request).
      //
      // Spec: specs/11-payments-subscriptions/requirements.md AC 9.3
      const verdict = await assertEntitlement(userId, "create_workout");
      if (!verdict.allowed) {
        throw new EntitlementError(verdict, "create_workout");
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
