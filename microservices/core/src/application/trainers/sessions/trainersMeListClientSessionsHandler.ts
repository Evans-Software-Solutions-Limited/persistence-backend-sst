import Elysia, { t } from "elysia";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";
import { SessionService } from "../../repositories/sessionService";
import { assertTrainerCanActForClient } from "../../relationships/assertTrainerCanActForClient";

/**
 * GET /trainers/me/clients/:clientId/sessions — parity read (cross-cuts § 1.2,
 * locked 2026-05-25) letting a coach list a client's workout sessions. Same
 * query shape + wire shape as the self `GET /sessions` so the mobile side
 * reuses its session-list mapping unchanged.
 *
 * Authorization goes through the shared `assertTrainerCanActForClient` gate
 * (role-first, then active relationship — cross-cuts § 1.3). Reads are NOT
 * audited (only on-behalf writes are — cross-cuts § 1.4).
 */
export const trainersMeListClientSessionsHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(SessionService)
  .get(
    "/trainers/me/clients/:clientId/sessions",
    async (ctx) => {
      const { sub: trainerId } = getUser(ctx);
      const { clientId } = ctx.params as { clientId: string };

      const verdict = await assertTrainerCanActForClient(trainerId, clientId);
      if (!verdict.allowed) {
        ctx.set.status = verdict.status;
        return verdict.body;
      }

      const { limit, offset, status } = ctx.query;
      const sessions = await ctx.SessionRepository.list(clientId, {
        limit: limit ?? 20,
        offset: offset ?? 0,
        status,
      });

      return { data: sessions };
    },
    {
      params: t.Object({ clientId: t.String({ minLength: 1 }) }),
      query: t.Object({
        limit: t.Optional(t.Numeric()),
        offset: t.Optional(t.Numeric()),
        status: t.Optional(
          t.Union([
            t.Literal("in_progress"),
            t.Literal("completed"),
            t.Literal("cancelled"),
          ]),
        ),
      }),
    },
  );
