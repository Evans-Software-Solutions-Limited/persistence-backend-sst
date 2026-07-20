import Elysia, { t } from "elysia";
import { ProgramService } from "../../repositories/programService";
import { assertTrainerCanActForClient } from "../../relationships/assertTrainerCanActForClient";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";
import { todayIso } from "./shared";

/**
 * GET /trainers/me/clients/:clientId/active-programme — a coach reads the
 * client's currently-live programme for the Client Detail `ProgrammeCard`
 * (specs/19-programs AC 4.5 / T-19.3.5). Same wire shape as the athlete's
 * own Home card (`ActiveProgrammeSummary`), so the mobile side reuses the
 * shared `<ProgrammeCard>` unchanged. `null` = no live plan-visible programme.
 *
 * Authorization: `assertTrainerCanActForClient` (25-coach-client-offboarding
 * guard consolidation) — role check first, then an ACTIVE, non-AI relationship
 * with :clientId, then client-not-soft-deleted (Cluster 2a). Replaces the
 * former inline relationship-only check. This is a read of a single client's
 * derived programme state, so no audit row.
 */
export const trainersClientActiveProgrammeGetHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(ProgramService)
  .get(
    "/trainers/me/clients/:clientId/active-programme",
    async (ctx) => {
      const { sub: trainerId } = getUser(ctx);
      const { clientId } = ctx.params;

      const verdict = await assertTrainerCanActForClient(trainerId, clientId);
      if (!verdict.allowed) {
        ctx.set.status = verdict.status;
        return verdict.body;
      }

      const programme =
        await ctx.ProgramAssignmentRepository.getActiveProgrammeForClient(
          clientId,
          todayIso(),
        );
      return { data: programme };
    },
    { params: t.Object({ clientId: t.String({ minLength: 1 }) }) },
  );
