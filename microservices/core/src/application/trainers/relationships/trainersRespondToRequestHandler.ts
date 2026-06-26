import Elysia, { t } from "elysia";
import { and, eq } from "drizzle-orm";
import { ptClientRelationships } from "@persistence/db";
import { getDb } from "@persistence/db/client";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

/**
 * POST /clients/me/relationships/:relationshipId/respond — the CLIENT accepts
 * or declines a pending trainer request.
 *
 * Body: { action: "accept" | "decline" }
 *
 * The canonical connection flow is coach-initiated → client-accepted (the
 * coach creates a `pending` relationship via email invite or invite code).
 * This endpoint is the client's side of that handshake:
 *   - accept  → status 'pending' → 'active'. The shared
 *               `create_pt_relationship_notifications` Postgres trigger fires
 *               on this transition and notifies the TRAINER ("client accepted
 *               your request"), so no manual notification is emitted here.
 *   - decline → status 'pending' → 'terminated'. No notification.
 *
 * Ownership: the relationship MUST belong to the caller as the client
 * (`client_id = userId`) and be `pending`. The status guard in the UPDATE
 * WHERE closes the race where two taps (or a concurrent trainer action) both
 * try to move the row — only the first update matches `status = 'pending'`.
 */
export const trainersRespondToRequestHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .post(
    "/clients/me/relationships/:relationshipId/respond",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const db = getDb();
      const { relationshipId } = ctx.params as { relationshipId: string };
      const { action } = ctx.body as { action: "accept" | "decline" };

      const nextStatus = action === "accept" ? "active" : "terminated";

      const updated = await db
        .update(ptClientRelationships)
        .set({ status: nextStatus, updatedAt: new Date() })
        .where(
          and(
            eq(ptClientRelationships.id, relationshipId),
            eq(ptClientRelationships.clientId, userId),
            eq(ptClientRelationships.status, "pending"),
          ),
        )
        .returning({
          id: ptClientRelationships.id,
          trainerId: ptClientRelationships.trainerId,
          status: ptClientRelationships.status,
        });

      const row = updated[0];
      if (!row) {
        // Either the relationship doesn't exist, isn't the caller's, or has
        // already moved out of 'pending'. 404 keeps the existence of other
        // users' relationships opaque.
        ctx.set.status = 404;
        return {
          code: "not_found",
          message: "No pending request found for this relationship",
        };
      }

      return {
        data: {
          success: true,
          relationshipId: row.id,
          trainerId: row.trainerId,
          status: row.status,
        },
      };
    },
    {
      params: t.Object({ relationshipId: t.String({ minLength: 1 }) }),
      body: t.Object({
        action: t.Union([t.Literal("accept"), t.Literal("decline")]),
      }),
    },
  );
