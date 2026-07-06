import Elysia, { t } from "elysia";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";
import { ISO_DATE_PATTERN } from "../programs/shared";
import { assignClientWorkoutOnBehalf } from "./assignClientWorkout";

/**
 * POST /trainers/me/clients/:clientId/workout-assignments — ad-hoc
 * single-workout assignment (specs/19-programs STORY-006): a
 * `workout_assignments` row with NO programme linkage. Feeds adherence /
 * dashboard / library identically to programme occurrences.
 *
 * Re-homed in Phase 3 onto the shared `assignClientWorkoutOnBehalf` core so
 * the write is authorized through `assertTrainerCanActForClient` (role-first,
 * then active relationship), audited in the same transaction as the insert,
 * and emits a `workout_assigned` client notification post-commit.
 */
export const trainersClientWorkoutAssignmentsCreateHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .post(
    "/trainers/me/clients/:clientId/workout-assignments",
    async (ctx) => {
      const { sub: trainerId } = getUser(ctx);
      const { clientId } = ctx.params as { clientId: string };

      const result = await assignClientWorkoutOnBehalf({
        trainerId,
        clientId,
        body: {
          workoutId: ctx.body.workoutId,
          dueDate: ctx.body.dueDate ?? null,
          showInPlan: ctx.body.showInPlan,
          showInLibrary: ctx.body.showInLibrary,
          trainerNotes: ctx.body.trainerNotes ?? null,
        },
      });

      if (!result.ok) {
        ctx.set.status = result.status;
        return result.body;
      }

      ctx.set.status = 201;
      return { data: result.assignment };
    },
    {
      params: t.Object({ clientId: t.String({ minLength: 1 }) }),
      body: t.Object({
        workoutId: t.String({ minLength: 1 }),
        dueDate: t.Optional(
          t.Union([t.String({ pattern: ISO_DATE_PATTERN }), t.Null()]),
        ),
        showInPlan: t.Optional(t.Boolean()),
        showInLibrary: t.Optional(t.Boolean()),
        trainerNotes: t.Optional(
          t.Union([t.String({ maxLength: 2000 }), t.Null()]),
        ),
      }),
    },
  );
