import Elysia from "elysia";
import { TrainerService } from "../../repositories/trainerService";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

/**
 * GET /trainers/me/clients — the Clients-tab roster. Returns one
 * `TrainerClient` per active/pending non-AI relationship, with v1 28-day
 * adherence + band, last-seen, and the derivable flags. Trainer-role-gated:
 * returns 403 when the caller is not a trainer / physiotherapist (or admin).
 */
export const trainersClientsListHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(TrainerService)
  .get("/trainers/me/clients", async (ctx) => {
    const { sub: userId } = getUser(ctx);

    if (!(await ctx.TrainerRepository.isTrainer(userId))) {
      ctx.set.status = 403;
      return { message: "Forbidden" };
    }

    const data = await ctx.TrainerRepository.getClients(userId);
    return { data };
  });
