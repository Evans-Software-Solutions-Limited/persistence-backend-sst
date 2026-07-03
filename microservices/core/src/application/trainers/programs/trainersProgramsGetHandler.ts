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
 * GET /trainers/me/programs/:id — programme detail for the editor: metadata
 * + ordered cycle + assignments (with derived current week). 404 covers
 * both missing and un-owned (no existence leak — requirements AC 1.6).
 */
export const trainersProgramsGetHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(TrainerService)
  .use(ProgramService)
  .get(
    "/trainers/me/programs/:id",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);

      if (!(await ctx.TrainerRepository.isTrainer(userId))) {
        ctx.set.status = 403;
        return { message: "Forbidden" };
      }

      const detail = await ctx.ProgramRepository.get(
        userId,
        ctx.params.id,
        todayIso(),
      );
      if (!detail) {
        ctx.set.status = 404;
        return { code: "not_found", message: "Programme not found" };
      }
      return { data: detail };
    },
    { params: t.Object({ id: t.String({ minLength: 1 }) }) },
  );
