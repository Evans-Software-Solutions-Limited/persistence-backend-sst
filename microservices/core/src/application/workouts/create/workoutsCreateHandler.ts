import Elysia, { t } from "elysia";
import { WorkoutService } from "../../repositories/workoutService";
import {
  findInvalidRepRangeIndex,
  workoutExerciseInputSchema,
} from "../shared/schemas";
import { readIdempotencyKey } from "../../shared/idempotencyKey";
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
        showInOwnerLibrary,
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
      // Client-supplied idempotency key (mobile sync queue). See the repository.
      const clientRequestId = readIdempotencyKey(ctx.headers);

      // ⚠ Resolve a REPLAY before the entitlement gate, not after.
      //
      // The first attempt's insert fires the workout-count trigger, so a user who
      // was one workout below their limit is AT it by the time a replay arrives —
      // and `assertEntitlement` would deny with reason `limit`. The user would be
      // shown an upgrade paywall for a workout that already exists, and since the
      // queue entry never reaches `completed`, the optimistic `local-…` row would be
      // preserved on every refresh alongside the committed server row: the workout
      // listed twice, the local copy 400ing when opened.
      //
      // The key's promise is that a replay is indistinguishable from the original
      // success, so it has to short-circuit ahead of any check whose answer the
      // first attempt itself changed. Returning 201 is correct — it is the same
      // response the original attempt produced, which is the point.
      if (clientRequestId) {
        const replay = await ctx.WorkoutRepository.findByClientRequestId(
          userId,
          clientRequestId,
        );
        if (replay) {
          ctx.set.status = 201;
          return { data: replay };
        }
      }

      // EntitlementError surfaces as HTTP 402 via coreErrorHandler with
      // a structured body the mobile feature-gate adapter parses
      // verbatim (see shared/errorHandler.ts).
      //
      // Position: AFTER input validation (so an invalid payload still
      // returns the more informative 400 / 422) and after the replay
      // short-circuit above, BEFORE createWithExercises (so we never
      // insert a workout the user isn't entitled to — including avoiding
      // the workout-count increment trigger firing on a denied request).
      //
      // Spec: specs/11-payments-subscriptions/requirements.md AC 9.3
      const verdict = await assertEntitlement(userId, "create_workout");
      if (!verdict.allowed) {
        throw new EntitlementError(verdict, "create_workout");
      }

      const workout = await ctx.WorkoutRepository.createWithExercises(
        userId,
        {
          name,
          description: description ?? null,
          visibility: visibility ?? "private",
          // Passed through as-is: absent means "derive it from the plan", which
          // the repository does. A `?? 30` here would defeat that by making the
          // duration always explicit — the bug this replaces.
          estimatedDurationMinutes,
          // Absent => true (personal). The coach-authoring flow sends false so
          // client-authored workouts don't crowd the coach's own My Workouts.
          showInOwnerLibrary: showInOwnerLibrary ?? true,
          exercises: exercises ?? [],
        },
        clientRequestId,
      );

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
        showInOwnerLibrary: t.Optional(t.Boolean()),
        exercises: t.Optional(t.Array(workoutExerciseInputSchema)),
      }),
    },
  );
