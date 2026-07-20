import Elysia, { t } from "elysia";
import { and, eq } from "drizzle-orm";
import { ptClientRelationships } from "@persistence/db";
import { getDb } from "@persistence/db/client";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";
import { endCoachClientRelationship } from "../../relationships/endCoachClientRelationship";
import { notifyRelationshipEnded } from "../../relationships/notifyRelationshipEnded";

/**
 * DELETE /clients/me/relationships/:relationshipId — the CLIENT leaves a coach
 * (25-coach-client-offboarding, US-2). Mirrors the client-side prefix of the
 * accept/decline handler (`/clients/me/relationships/:relationshipId/respond`).
 *
 * We resolve the trainer from the row under a caller-scoped, active, non-AI
 * lookup (`id = :relationshipId AND client_id = caller AND status = 'active'
 * AND is_ai_trainer = false`) — this never reveals another user's relationship,
 * and 404s on not-yours / already-ended / AI-trainer (an AI trainer is removed
 * by cancelling the subscription, not here). The shared teardown then re-applies
 * the same guard inside its transaction (idempotent against a concurrent end).
 *
 * Teardown identical to the coach path: soft-end + delete this coach's
 * assignments for the client; habits/goals transfer to the client (locked
 * decision 6). The coach is notified best-effort, post-commit.
 */
export const clientLeaveCoachHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .delete(
    "/clients/me/relationships/:relationshipId",
    async (ctx) => {
      const { sub: clientId } = getUser(ctx);
      const { relationshipId } = ctx.params;

      const rows = await getDb()
        .select({ trainerId: ptClientRelationships.trainerId })
        .from(ptClientRelationships)
        .where(
          and(
            eq(ptClientRelationships.id, relationshipId),
            eq(ptClientRelationships.clientId, clientId),
            eq(ptClientRelationships.status, "active"),
            eq(ptClientRelationships.isAiTrainer, false),
          ),
        )
        .limit(1);

      const trainerId = rows[0]?.trainerId;
      if (!trainerId) {
        ctx.set.status = 404;
        return { code: "not_found", message: "Coach relationship not found" };
      }

      const result = await endCoachClientRelationship({
        trainerId,
        clientId,
        initiatedBy: "client",
      });

      if (!result.ok) {
        // Lost a race to a concurrent end — treat as already gone.
        ctx.set.status = 404;
        return { code: "not_found", message: "Coach relationship not found" };
      }

      await notifyRelationshipEnded({
        recipientId: trainerId,
        otherPartyId: clientId,
        initiatedBy: "client",
        relationshipId: result.relationshipId,
      });

      return { data: { ended: true } };
    },
    {
      params: t.Object({
        relationshipId: t.String({ minLength: 1 }),
      }),
    },
  );
