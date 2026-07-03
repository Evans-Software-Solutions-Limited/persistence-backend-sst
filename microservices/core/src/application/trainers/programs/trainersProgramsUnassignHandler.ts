import Elysia, { t } from "elysia";
import { ProgramService } from "../../repositories/programService";
import { TrainerService } from "../../repositories/trainerService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";
import { todayIso } from "./shared";

/**
 * DELETE /trainers/me/programs/:id/assignments/:assignmentId — unassign:
 * marks the assignment `skipped` and prunes FUTURE untouched occurrences;
 * completed history stays (requirements AC 3.4). 404 covers missing,
 * un-owned, or already-terminal assignments. No relationship guard: the
 * assignment row's `assigned_by = caller` IS the permission — a coach can
 * (and must be able to) unassign after a relationship ends.
 */
export const trainersProgramsUnassignHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(TrainerService)
  .use(ProgramService)
  .delete(
    "/trainers/me/programs/:id/assignments/:assignmentId",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);

      if (!(await ctx.TrainerRepository.isTrainer(userId))) {
        ctx.set.status = 403;
        return { message: "Forbidden" };
      }

      const result = await ctx.ProgramAssignmentRepository.unassign(
        userId,
        ctx.params.id,
        ctx.params.assignmentId,
        todayIso(),
      );
      if (result === "not_found") {
        ctx.set.status = 404;
        return { code: "not_found", message: "Assignment not found" };
      }
      return { data: { unassigned: true } };
    },
    {
      params: t.Object({
        id: t.String({ minLength: 1 }),
        assignmentId: t.String({ minLength: 1 }),
      }),
    },
  );
