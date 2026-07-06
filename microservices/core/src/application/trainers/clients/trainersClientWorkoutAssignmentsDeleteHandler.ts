import Elysia, { t } from "elysia";
import { getDb } from "@persistence/db/client";
import { ProgramService } from "../../repositories/programService";
import { TrainerService } from "../../repositories/trainerService";
import { auditTrainerAction } from "../../relationships/auditTrainerAction";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

/**
 * DELETE /trainers/me/clients/:clientId/workout-assignments/:id — remove an
 * ad-hoc assignment. Only untouched (`assigned`, non-programme) rows are
 * deletable: 409 once completed (history is adherence data) or when the row
 * is a programme occurrence (unassign the programme instead). Ownership
 * (trainer_id = caller) is folded into the repo query — no relationship
 * guard needed, and unassigning must keep working after a relationship
 * ends.
 *
 * The delete + `trainer_actions_audit` insert (action `workout_unassigned`)
 * land in ONE transaction (cross-cuts § 1.4.2) — mirrors the CREATE path's
 * `assignClientWorkoutOnBehalf` fix (PR #165). 404/409 short-circuit before
 * any write, so those paths commit with no rows and no audit.
 */
export const trainersClientWorkoutAssignmentsDeleteHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(TrainerService)
  .use(ProgramService)
  .delete(
    "/trainers/me/clients/:clientId/workout-assignments/:id",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);

      if (!(await ctx.TrainerRepository.isTrainer(userId))) {
        ctx.set.status = 403;
        return { message: "Forbidden" };
      }

      const { clientId, id: assignmentId } = ctx.params;

      const outcome = await getDb().transaction(async (tx) => {
        const deletion = await ctx.ProgramAssignmentRepository.deleteAdHoc(
          userId,
          clientId,
          assignmentId,
          tx,
        );
        if (deletion.result !== "deleted") return deletion;

        await auditTrainerAction({
          trainerId: userId,
          clientId,
          actionType: "workout_unassigned",
          targetTable: "workout_assignments",
          targetRowId: deletion.assignment.id,
          payload: {
            workoutId: deletion.assignment.workoutId,
            dueDate: deletion.assignment.dueDate,
          },
          tx,
        });

        return deletion;
      });

      if (outcome.result === "not_found") {
        ctx.set.status = 404;
        return { code: "not_found", message: "Assignment not found" };
      }
      if (outcome.result === "not_deletable") {
        ctx.set.status = 409;
        return {
          code: "not_deletable",
          message:
            "Only untouched ad-hoc assignments can be removed — programme occurrences are managed by unassigning the programme",
        };
      }
      return { data: { deleted: true } };
    },
    {
      params: t.Object({
        clientId: t.String({ minLength: 1 }),
        id: t.String({ minLength: 1 }),
      }),
    },
  );
