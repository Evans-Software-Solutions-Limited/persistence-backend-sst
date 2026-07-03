import Elysia, { t } from "elysia";
import { ProgramService } from "../../repositories/programService";
import { TrainerService } from "../../repositories/trainerService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

/**
 * DELETE /trainers/me/programs/:id — 409 while live assignments exist
 * (unassign clients first); terminal-assignment history cascades with the
 * programme once the coach truly deletes (requirements AC 1.5).
 */
export const trainersProgramsDeleteHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(TrainerService)
  .use(ProgramService)
  .delete(
    "/trainers/me/programs/:id",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);

      if (!(await ctx.TrainerRepository.isTrainer(userId))) {
        ctx.set.status = 403;
        return { message: "Forbidden" };
      }

      const result = await ctx.ProgramRepository.delete(userId, ctx.params.id);
      if (result === "has_live_assignments") {
        ctx.set.status = 409;
        return {
          code: "PROGRAM_HAS_LIVE_ASSIGNMENTS",
          message: "Unassign all clients before deleting this programme",
        };
      }
      if (result === "not_found") {
        ctx.set.status = 404;
        return { code: "not_found", message: "Programme not found" };
      }
      return { data: { deleted: true } };
    },
    { params: t.Object({ id: t.String({ minLength: 1 }) }) },
  );
