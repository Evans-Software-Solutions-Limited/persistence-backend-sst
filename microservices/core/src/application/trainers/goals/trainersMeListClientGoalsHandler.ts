import Elysia, { t } from "elysia";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";
import { GoalService } from "../../repositories/goalService";
import { assertTrainerCanActForClient } from "../../relationships/assertTrainerCanActForClient";
import { auditClientDataRead } from "../../relationships/auditClientDataRead";

/**
 * GET /trainers/me/clients/:clientId/goals — parity read (cross-cuts § 1.2)
 * letting a coach list a client's goals (self-set and coach-assigned alike).
 * Same query + wire shape as the self `GET /goals`. Authorization via the
 * shared `assertTrainerCanActForClient` gate (cross-cuts § 1.3). The read is
 * logged to the coach read-audit (specs/27-coach-health-data-read-audit) AFTER
 * the gate passes, via the best-effort `auditClientDataRead` helper.
 */
export const trainersMeListClientGoalsHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(GoalService)
  .get(
    "/trainers/me/clients/:clientId/goals",
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
        dataCategory: "goals",
        route: "/trainers/me/clients/:clientId/goals",
      }).catch(() => {});

      const { limit, offset } = ctx.query;
      const goals = await ctx.GoalRepository.list(
        clientId,
        limit ?? 20,
        offset ?? 0,
      );

      return { data: goals };
    },
    {
      params: t.Object({ clientId: t.String({ minLength: 1 }) }),
      query: t.Object({
        limit: t.Optional(t.Numeric()),
        offset: t.Optional(t.Numeric()),
      }),
    },
  );
