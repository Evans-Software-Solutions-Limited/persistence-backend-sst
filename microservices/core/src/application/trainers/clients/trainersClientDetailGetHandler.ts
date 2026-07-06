import Elysia, { t } from "elysia";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";
import { ClientDetailRepository } from "../../repositories/clientDetailRepository";
import { assertTrainerCanActForClient } from "../../relationships/assertTrainerCanActForClient";

/**
 * GET /trainers/me/clients/:clientId — the Client Detail read aggregate for the
 * coach's single-scroll screen (specs/10-trainer-features/design.md § "Client
 * Detail — functional contract", STORY-003; Phase 5). Composes modules a–f +
 * the aiSummary stub + thisWeek + recentSessions + notes out of the existing
 * athlete repos called with the CLIENT's userId.
 *
 * Gate order (design.md § the aggregate endpoint): JWT (requireAuth) → role ∈
 * {personal_trainer, physiotherapist, admin} → active relationship — the last
 * two are the shipped `assertTrainerCanActForClient` verdict (role-first, then
 * relationship), mapped to its 403 body exactly like every Phase-3 handler.
 * This is a READ, so no audit row (cross-cuts § 1.4).
 *
 * Mounted as its OWN handler (a sibling of `trainersOnBehalfRoutes`) with a
 * single `.get` and no long decorator chain, to keep the root Elysia type
 * instantiation under TS's depth ceiling (TS2589). It sits alongside the more
 * specific `…/:clientId/active-programme`, `…/:clientId/goals`, etc.; Elysia
 * matches static segments before the terminal `:clientId`, so the bare route
 * does not shadow them (guarded by a route-ordering test).
 */
export const trainersClientDetailGetHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .get(
    "/trainers/me/clients/:clientId",
    async (ctx) => {
      const { sub: trainerId } = getUser(ctx);
      const { clientId } = ctx.params as { clientId: string };

      const verdict = await assertTrainerCanActForClient(trainerId, clientId);
      if (!verdict.allowed) {
        ctx.set.status = verdict.status;
        return verdict.body;
      }

      const data = await new ClientDetailRepository().getClientDetail(
        trainerId,
        clientId,
      );
      return { data };
    },
    {
      params: t.Object({ clientId: t.String({ minLength: 1 }) }),
    },
  );
