import Elysia, { t } from "elysia";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";
import { ClientDetailRepository } from "../../repositories/clientDetailRepository";
import { assertTrainerCanActForClient } from "../../relationships/assertTrainerCanActForClient";
import { auditClientDataRead } from "../../relationships/auditClientDataRead";

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
 * This is a READ, so no `trainer_actions_audit` row (cross-cuts § 1.4) — but it
 * IS logged to the coach read-audit (specs/27-coach-health-data-read-audit,
 * category `client_detail_aggregate`) since this is the highest-volume
 * aggregate read of a client's health/fitness data. The mobile Client Detail
 * screen re-fetches on every focus, so `auditClientDataRead`'s de-dupe window
 * coarsens repeat views down to one row per window rather than one per fetch.
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

      await auditClientDataRead({
        trainerId,
        clientId,
        dataCategory: "client_detail_aggregate",
        route: "/trainers/me/clients/:clientId",
      }).catch(() => {});

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
