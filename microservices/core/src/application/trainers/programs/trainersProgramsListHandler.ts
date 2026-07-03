import Elysia from "elysia";
import { ProgramService } from "../../repositories/programService";
import { TrainerService } from "../../repositories/trainerService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

/**
 * GET /trainers/me/programs — the coach's programme library
 * (specs/19-programs STORY-002). Each summary carries workoutCount +
 * activeClientCount; ACTIVE/DRAFT is derived client-side from
 * activeClientCount > 0.
 */
export const trainersProgramsListHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(TrainerService)
  .use(ProgramService)
  .get("/trainers/me/programs", async (ctx) => {
    const { sub: userId } = getUser(ctx);

    if (!(await ctx.TrainerRepository.isTrainer(userId))) {
      ctx.set.status = 403;
      return { message: "Forbidden" };
    }

    const data = await ctx.ProgramRepository.list(userId);
    return { data };
  });
