import Elysia, { t } from "elysia";
import { and, eq } from "drizzle-orm";
import { profiles, ptClientRelationships } from "@persistence/db";
import { getDb } from "@persistence/db/client";
import { ProgramService } from "../../repositories/programService";
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
 * Authorization: an ACTIVE, non-AI relationship with :clientId as the trainer
 * (403 `not_your_client` otherwise) — identical inline guard to
 * `trainersClientBodyTrendHandler`. This is a read of a single client's
 * derived programme state, so no audit row.
 *
 * Cluster 2a: also denies (same 403 `not_your_client` body — never disclose
 * the specific reason) when the client is soft-deleted, joined into the same
 * query. Brad's "hide from coach immediately" call.
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
          message: "You can only view programmes for your active clients",
        };
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
