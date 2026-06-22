import Elysia from "elysia";
import { TrainerService } from "../../repositories/trainerService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

/**
 * GET /trainers/me/overview — single aggregate powering the Coach You
 * dashboard. Trainer-role-gated: returns 403 when the caller is not a
 * trainer / physiotherapist (or admin).
 */
export const trainersOverviewHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(TrainerService)
  .get("/trainers/me/overview", async (ctx) => {
    const { sub: userId } = getUser(ctx);

    if (!(await ctx.TrainerRepository.isTrainer(userId))) {
      ctx.set.status = 403;
      return { message: "Forbidden" };
    }

    const overview = await ctx.TrainerRepository.getOverview(userId);
    return { data: overview };
  });
