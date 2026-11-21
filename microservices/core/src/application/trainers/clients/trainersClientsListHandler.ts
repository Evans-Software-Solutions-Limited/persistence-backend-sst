import Elysia from "elysia";
import { TrainerService } from "../../repositories/trainerService";
import { ClientProfileRepository } from "../../coaching/clientProfileRepository";
import { rosterAdherenceByArea } from "../../adherence/coachAdherence";
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
 *
 * PER-108 (design A D3): adds a sibling `invited` field — the coach's invited
 * client profiles that haven't accepted yet. `data` is exactly as before, so
 * 1.2.0 coach bundles, which read `data` only, see no change.
 *
 * PER-114 (design B D3): each item gains `adherenceByArea` — per tracked area,
 * from the one shared calculation (rolling 7 days). `null` for a pending
 * client (no active relationship yet); `{}` when the coach tracks nothing.
 * The legacy `adherence`, `band` (old 28-day assignment calculation) and the
 * sort order are unchanged, so 1.2.0 bundles show exactly what they do today.
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

    const roster = await ctx.TrainerRepository.getClients(userId);
    const byArea = await rosterAdherenceByArea(
      userId,
      roster.filter((c) => c.status === "active").map((c) => c.id),
    );
    const data = roster.map((c) => ({
      ...c,
      adherenceByArea: byArea.get(c.id) ?? null,
    }));
    const invited = await new ClientProfileRepository().invitedSummaries(
      userId,
    );
    return { data, invited };
  });
