import Elysia, { t } from "elysia";
import { and, eq } from "drizzle-orm";
import { profiles, ptClientRelationships } from "@persistence/db";
import { getDb } from "@persistence/db/client";
import { HomeReadService } from "../../repositories/homeReadService";
import { parseBodyTrendWindow } from "../../progress/getBodyTrendHandler";
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
 * Authorization: identical to the coach measurement-log route — the caller
 * MUST have an ACTIVE, non-AI relationship with :clientId as the trainer.
 * 403 otherwise (`not_your_client`).
 *
 * Cluster 2a: also denies (same 403 body) when the client is soft-deleted,
 * joined into the same query. Brad's "hide from coach immediately" call.
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

      // Active-relationship guard (trainer side of the pair) — mirrors
      // trainersLogClientMeasurementHandler. Joined to the client's profile
      // so a soft-deleted client (Cluster 2a) is denied in the same
      // round-trip.
      const db = getDb();
      const rel = await db
        .select({
          id: ptClientRelationships.id,
          clientDeletedAt: profiles.deletedAt,
        })
        .from(ptClientRelationships)
        .innerJoin(profiles, eq(ptClientRelationships.clientId, profiles.id))
        .where(
          and(
            eq(ptClientRelationships.trainerId, trainerId),
            eq(ptClientRelationships.clientId, clientId),
            eq(ptClientRelationships.status, "active"),
            eq(ptClientRelationships.isAiTrainer, false),
          ),
        )
        .limit(1);

      if (!rel[0] || rel[0].clientDeletedAt != null) {
        ctx.set.status = 403;
        return {
          code: "not_your_client",
          message: "You can only view measurements for your active clients",
        };
      }

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
