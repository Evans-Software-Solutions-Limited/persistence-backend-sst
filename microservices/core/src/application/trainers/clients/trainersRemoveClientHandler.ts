import Elysia, { t } from "elysia";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";
import { endCoachClientRelationship } from "../../relationships/endCoachClientRelationship";
import { notifyRelationshipEnded } from "../../relationships/notifyRelationshipEnded";

/**
 * DELETE /trainers/me/clients/:clientId — the COACH removes a client from
 * their roster (25-coach-client-offboarding, US-1).
 *
 * Authorization is folded into the shared teardown's conditional UPDATE
 * (`trainer_id = caller AND client_id = :clientId AND status = 'active' AND
 * is_ai_trainer = false`): only the trainer on an active, human relationship
 * can end it. A miss (not yours / already ended / AI-trainer) → 404 with no
 * partial teardown. No seat/entitlement guard — removal only frees a seat.
 *
 * On success the relationship is soft-ended (status 'terminated', end_date
 * set) and the coach's workout + programme assignments for this client are
 * deleted. Coach-set habits/goals transfer to the client automatically (the
 * status-computed edit-lock lifts — locked decision 6). The client is notified
 * best-effort, post-commit.
 */
export const trainersRemoveClientHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .delete(
    "/trainers/me/clients/:clientId",
    async (ctx) => {
      const { sub: trainerId } = getUser(ctx);
      const { clientId } = ctx.params;

      const result = await endCoachClientRelationship({
        trainerId,
        clientId,
        initiatedBy: "trainer",
      });

      if (!result.ok) {
        ctx.set.status = 404;
        return { code: "not_found", message: "Client relationship not found" };
      }

      // Best-effort, post-commit — never fails the teardown.
      await notifyRelationshipEnded({
        recipientId: clientId,
        otherPartyId: trainerId,
        initiatedBy: "trainer",
        relationshipId: result.relationshipId,
      });

      return { data: { ended: true } };
    },
    {
      params: t.Object({
        clientId: t.String({ minLength: 1 }),
      }),
    },
  );
