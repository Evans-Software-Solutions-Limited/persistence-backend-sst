import Elysia, { t } from "elysia";
import { and, desc, eq, isNull } from "drizzle-orm";
import { ptClientRelationships, profiles } from "@persistence/db";
import { getDb } from "@persistence/db/client";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

/**
 * GET /clients/me/relationships?status=pending|active — the CLIENT's view of
 * their trainer relationships, joined to the trainer profile for display.
 *
 * Powers two surfaces:
 *   - the in-app Requests screen (`?status=pending`) where the client accepts
 *     or declines incoming coach requests;
 *   - the "Your trainer" / progress-with-trainer section on the You page
 *     (`?status=active`).
 *
 * `status` is optional; omitting it returns pending + active (the two states
 * a client cares about — terminated/inactive are hidden). Human trainers only
 * (`is_ai_trainer = false`); the self-relationship AI trainer is excluded so
 * it never shows up as an incoming request.
 *
 * Ownership: scoped to `client_id = userId` (JWT subject), never a body param.
 */
export const trainersClientRelationshipsListHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .get(
    "/clients/me/relationships",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const db = getDb();
      const { status } = ctx.query as { status?: "pending" | "active" };

      const conditions = [
        eq(ptClientRelationships.clientId, userId),
        eq(ptClientRelationships.isAiTrainer, false),
        // Cluster 2a — a soft-deleted trainer must disappear from the
        // client's own view immediately (innerJoin means a missing profiles
        // row already excludes the relationship; this excludes a profile
        // row that still exists but is mid-deletion).
        isNull(profiles.deletedAt),
      ];
      if (status) {
        conditions.push(eq(ptClientRelationships.status, status));
      }

      const rows = await db
        .select({
          relationshipId: ptClientRelationships.id,
          trainerId: ptClientRelationships.trainerId,
          status: ptClientRelationships.status,
          initiatedBy: ptClientRelationships.initiatedBy,
          relationshipReason: ptClientRelationships.relationshipReason,
          createdAt: ptClientRelationships.createdAt,
          trainerName: profiles.fullName,
          trainerRole: profiles.role,
          trainerAvatarUrl: profiles.avatarUrl,
        })
        .from(ptClientRelationships)
        .innerJoin(profiles, eq(profiles.id, ptClientRelationships.trainerId))
        .where(and(...conditions))
        .orderBy(desc(ptClientRelationships.createdAt));

      // Hide terminated/inactive when no explicit status filter was given.
      const visible = status
        ? rows
        : rows.filter((r) => r.status === "pending" || r.status === "active");

      return {
        data: visible.map((r) => ({
          relationshipId: r.relationshipId,
          trainerId: r.trainerId,
          trainerName: r.trainerName ?? "Your trainer",
          trainerRole: r.trainerRole ?? null,
          trainerAvatarUrl: r.trainerAvatarUrl ?? null,
          status: r.status,
          // 'trainer' = the client accepts this pending (email invite);
          // 'client' = the client redeemed a code, awaiting the coach's accept.
          initiatedBy: r.initiatedBy === "client" ? "client" : "trainer",
          relationshipReason: r.relationshipReason ?? null,
          since: r.createdAt ? new Date(r.createdAt).toISOString() : null,
        })),
      };
    },
    {
      query: t.Object({
        status: t.Optional(
          t.Union([t.Literal("pending"), t.Literal("active")]),
        ),
      }),
    },
  );
