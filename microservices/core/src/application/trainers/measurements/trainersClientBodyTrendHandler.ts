import Elysia, { t } from "elysia";
import { HomeReadService } from "../../repositories/homeReadService";
import { parseBodyTrendWindow } from "../../progress/getBodyTrendHandler";
import { assertTrainerCanActForClient } from "../../relationships/assertTrainerCanActForClient";
import { auditClientDataRead } from "../../relationships/auditClientDataRead";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

/**
 * GET /clients/:clientId/body-trend?window=30d — a coach reads a client's
 * body-measurement series (weight + body fat, oldest-first) for the Client
 * Detail trend section (10-trainer-features, Client Detail Overview).
 *
 * Same wire shape as the self route (`GET /users/me/body-trend`) so the
 * mobile side reuses `BodyTrendPoint` + `<BodyTrendPresenter>` unchanged.
 * Days are bucketed in the CLIENT's timezone — the coach sees the same
 * calendar days the client sees on their own You screen.
 *
 * Authorization: `assertTrainerCanActForClient` (25-coach-client-offboarding
 * guard consolidation) — role check FIRST (trainer/physio/admin, not
 * soft-deleted), then an ACTIVE, non-AI relationship with :clientId, then the
 * client not soft-deleted (Cluster 2a "hide from coach immediately"). Replaces
 * the former inline relationship-only check so a lapsed trainer whose role
 * reverted can no longer read a client's body trend off a stale relationship
 * row. 403 (`not_a_trainer` / `not_your_client` / `account_deleted`).
 */
export const trainersClientBodyTrendHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .use(HomeReadService)
  .get(
    "/clients/:clientId/body-trend",
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
        dataCategory: "body_trend",
        route: "/clients/:clientId/body-trend",
      }).catch(() => {});

      const windowDays = parseBodyTrendWindow(ctx.query.window);
      const tz = await ctx.HomeReadRepository.getUserTimezone(clientId);
      const series = await ctx.HomeReadRepository.getBodyTrend(
        clientId,
        windowDays,
        tz,
      );
      return { data: series };
    },
    {
      params: t.Object({ clientId: t.String({ minLength: 1 }) }),
      query: t.Object({ window: t.Optional(t.String()) }),
    },
  );
