import Elysia from "elysia";
import { TrainerService } from "../../repositories/trainerService";
import { overviewAdherenceByArea } from "../../adherence/coachAdherence";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

/**
 * GET /trainers/me/overview — single aggregate powering the Coach You
 * dashboard. Trainer-role-gated: returns 403 when the caller is not a
 * trainer / physiotherapist (or admin).
 *
 * PER-114 (design B D3): `data` gains `adherenceByArea`, the practice level
 * per tracked area over the coach's active clients (rolling 7 days, the one
 * shared calculation). Every existing field, including the legacy
 * `avgAdherence` / `adherenceDelta`, is unchanged.
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

    const [overview, adherenceByArea] = await Promise.all([
      ctx.TrainerRepository.getOverview(userId),
      overviewAdherenceByArea(userId),
    ]);
    return { data: { ...overview, adherenceByArea } };
  });
