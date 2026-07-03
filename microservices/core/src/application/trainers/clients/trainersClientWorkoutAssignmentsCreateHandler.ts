import Elysia, { t } from "elysia";
import { ProgramService } from "../../repositories/programService";
import { TrainerService } from "../../repositories/trainerService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";
import { hasActiveRelationship } from "../relationships/activeRelationshipGuard";
import { ISO_DATE_PATTERN, todayIso } from "../programs/shared";

/**
 * POST /trainers/me/clients/:clientId/workout-assignments — ad-hoc
 * single-workout assignment (specs/19-programs STORY-006): a
 * `workout_assignments` row with NO programme linkage. Feeds adherence /
 * dashboard / library identically to programme occurrences.
 */
export const trainersClientWorkoutAssignmentsCreateHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(TrainerService)
  .use(ProgramService)
  .post(
    "/trainers/me/clients/:clientId/workout-assignments",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const { clientId } = ctx.params;

      if (!(await ctx.TrainerRepository.isTrainer(userId))) {
        ctx.set.status = 403;
        return { message: "Forbidden" };
      }
      if (!(await hasActiveRelationship(userId, clientId))) {
        ctx.set.status = 403;
        return {
          code: "not_your_client",
          message: "You can only assign workouts to your active clients",
        };
      }

      const result = await ctx.ProgramAssignmentRepository.createAdHoc(
        userId,
        clientId,
        {
          workoutId: ctx.body.workoutId,
          dueDate: ctx.body.dueDate ?? null,
          showInPlan: ctx.body.showInPlan,
          showInLibrary: ctx.body.showInLibrary,
          trainerNotes: ctx.body.trainerNotes ?? null,
        },
        todayIso(),
      );

      if ("error" in result) {
        ctx.set.status = 422;
        return {
          code: "invalid_workout",
          message: "The workout must be your own or public",
        };
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
