import Elysia, { t } from "elysia";
import { and, eq } from "drizzle-orm";
import { ptClientRelationships, profiles } from "@persistence/db";
import { getDb } from "@persistence/db/client";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";
import {
  EntitlementError,
  evaluateTrainerClientsActiveSeat,
} from "../../entitlement/assertEntitlement";
import {
  NotificationRepository,
  type AppNotification,
} from "../../repositories/notificationRepository";
import { NotificationDispatcher } from "../../notifications/push/notificationDispatcher";
import { auditTrainerAction } from "../../relationships/auditTrainerAction";

/**
 * Where a tapped "coach accepted your request" notification lands: the athlete
 * You screen, where the now-active trainer shows. Scheme-host form (mobile's
 * deep-link resolver owns the route mapping); `profile` → /(app)/(tabs)/you.
 */
const ACCEPTED_DEEP_LINK = "persistencemobile://profile";

/**
 * Discriminated result of the accept transaction: success (carrying the athlete
 * id + the created notification for the post-commit push), or a plain 404. A
 * client-slot cap deny is NOT modelled here — the coach is the actor at accept
 * time, so an at-cap accept throws `EntitlementError` (→ 402 upsell, consistent
 * with #195/#196's invite-CREATION gate), which rolls the transaction back.
 */
type AcceptTxResult =
  | {
      data: {
        success: true;
        relationshipId: string;
        clientId: string;
        status: string | null;
      };
      clientId: string;
      notification: AppNotification;
    }
  | { code: string; message: string };

/**
 * The athlete-facing "your coach accepted" message. Mirrors the Phase-11
 * attribution copy: "Coach {name}" for a personal trainer, bare "{name}" for a
 * physio; a generic fallback when the profile row is missing.
 */
function acceptedMessage(
  trainer: { fullName: string | null; role: string | null } | undefined,
): string {
  if (!trainer?.fullName) return "Your coach accepted your request";
  return trainer.role === "physiotherapist"
    ? `${trainer.fullName} accepted your request`
    : `Coach ${trainer.fullName} accepted your request`;
}

/**
 * POST /trainers/me/relationships/:relationshipId/respond — the COACH accepts
 * or declines a client-initiated pending request (Coach Mode Phase 8, decision
 * #2). This is the trainer-side mirror of the client-side respond handler.
 *
 * Body: { action: "accept" | "decline" }
 *
 * The canonical invite-code flow is client-initiated → coach-accepted: the
 * athlete redeems the coach's code, creating a `pending` row with
 * `initiated_by = 'client'`. This endpoint is the coach's side of that
 * handshake:
 *   - accept  → 'pending' → 'active'. The seat-consumption moment, gated on
 *               the trainer's client-slot cap under a per-trainer row lock. The
 *               coach is the actor → an at-cap deny is a 402 upsell
 *               (EntitlementError). The ATHLETE is notified with a push
 *               (`coach_request_accepted`) — the shared trigger's pending→active
 *               branch is scoped to trainer-initiated rows, so it stays silent
 *               here.
 *   - decline → 'pending' → 'terminated'. No athlete notification (v1). Both
 *               outcomes write a `trainer_actions_audit` row in the same tx.
 *
 * Scope: the relationship MUST belong to the caller as the trainer
 * (`trainer_id = userId`), be `pending`, AND be `initiated_by = 'client'` — a
 * trainer-initiated (email-invite) pending awaits the CLIENT, so the coach
 * cannot accept it here (it would 404). Trainer-role-gated (RBAC dangerous
 * area). The `status = 'pending'` guard in every UPDATE closes the double-tap /
 * concurrent-move race (mirrors the client-side handler).
 */
export const trainersRespondToClientRequestHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .post(
    "/trainers/me/relationships/:relationshipId/respond",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const db = getDb();
      const { relationshipId } = ctx.params as { relationshipId: string };
      const { action } = ctx.body as { action: "accept" | "decline" };

      // Trainer-role gate (RBAC). Only a coach/physio/admin may act on the
      // trainer side of the handshake. The relationship scope below
      // (trainer_id = userId) is the ownership half; this is the role half.
      const profileRows = await db
        .select({ role: profiles.role })
        .from(profiles)
        .where(eq(profiles.id, userId))
        .limit(1);
      const role = profileRows[0]?.role;
      if (
        role !== "personal_trainer" &&
        role !== "physiotherapist" &&
        role !== "admin"
      ) {
        ctx.set.status = 403;
        return { code: "forbidden", message: "Forbidden" };
      }

      if (action === "decline") {
        // Decline never consumes a seat → a single conditional UPDATE, atomic
        // against a concurrent move. Audited inside a tx so the write + audit
        // land together (cross-cuts § 1.4.2).
        const result = await db.transaction(async (tx) => {
          const updated = await tx
            .update(ptClientRelationships)
            .set({ status: "terminated", updatedAt: new Date() })
            .where(
              and(
                eq(ptClientRelationships.id, relationshipId),
                eq(ptClientRelationships.trainerId, userId),
                eq(ptClientRelationships.status, "pending"),
                eq(ptClientRelationships.initiatedBy, "client"),
              ),
            )
            .returning({
              id: ptClientRelationships.id,
              clientId: ptClientRelationships.clientId,
              status: ptClientRelationships.status,
            });

          const row = updated[0];
          if (!row) return null;

          await auditTrainerAction({
            trainerId: userId,
            clientId: row.clientId,
            actionType: "client_request_declined",
            targetTable: "pt_client_relationships",
            targetRowId: row.id,
            payload: {},
            tx,
          });

          return row;
        });

        if (!result) {
          ctx.set.status = 404;
          return {
            code: "not_found",
            message: "No pending request found for this relationship",
          };
        }
        return {
          data: {
            success: true,
            relationshipId: result.id,
            clientId: result.clientId,
            status: result.status,
          },
        };
      }

      // Accept = pending → active. Resolve the coach's display name up front
      // (a read; used for the athlete notification copy).
      const trainerRows = await db
        .select({ fullName: profiles.fullName, role: profiles.role })
        .from(profiles)
        .where(eq(profiles.id, userId))
        .limit(1);
      const notifications = new NotificationRepository();

      const result = await db.transaction(
        async (tx): Promise<AcceptTxResult> => {
          // Resolve the client-initiated pending relationship (ownership-scoped)
          // to get the athlete before locking + counting.
          const relRows = await tx
            .select({
              id: ptClientRelationships.id,
              clientId: ptClientRelationships.clientId,
            })
            .from(ptClientRelationships)
            .where(
              and(
                eq(ptClientRelationships.id, relationshipId),
                eq(ptClientRelationships.trainerId, userId),
                eq(ptClientRelationships.status, "pending"),
                eq(ptClientRelationships.initiatedBy, "client"),
              ),
            )
            .limit(1);

          const rel = relRows[0];
          if (!rel) {
            ctx.set.status = 404;
            return {
              code: "not_found",
              message: "No pending request found for this relationship",
            };
          }

          // Per-trainer mutex, THEN count ACTIVE seats. The pending row being
          // accepted is excluded from the active count, so the check is "would
          // activating this row exceed the cap?". Concurrent accepts for the same
          // trainer serialise on this lock.
          await tx
            .select({ id: profiles.id })
            .from(profiles)
            .where(eq(profiles.id, userId))
            .for("update");

          const seat = await evaluateTrainerClientsActiveSeat(userId, tx);
          if (!seat.allowed) {
            // The coach is the actor here → 402 upsell (consistent with the
            // invite-CREATION gate in #195/#196), NOT the client-facing 409 the
            // redeem uses. Throwing rolls the tx back with no activation; the
            // shared error handler maps it to 402 with the upgrade verdict.
            throw new EntitlementError(seat, "trainer_clients");
          }

          // Activate. Conditional on status='pending' still guards a concurrent
          // move (double tap / client-side decline racing in).
          const updated = await tx
            .update(ptClientRelationships)
            .set({ status: "active", updatedAt: new Date() })
            .where(
              and(
                eq(ptClientRelationships.id, relationshipId),
                eq(ptClientRelationships.trainerId, userId),
                eq(ptClientRelationships.status, "pending"),
              ),
            )
            .returning({
              id: ptClientRelationships.id,
              clientId: ptClientRelationships.clientId,
              status: ptClientRelationships.status,
            });

          const row = updated[0];
          if (!row) {
            ctx.set.status = 404;
            return {
              code: "not_found",
              message: "No pending request found for this relationship",
            };
          }

          // The athlete-facing "coach accepted" notification IS emitted here
          // (in-tx row, post-commit push) rather than by the trigger, whose
          // pending→active branch is scoped to trainer-initiated rows.
          const notification = await notifications.create(
            row.clientId,
            {
              type: "coach_request_accepted",
              title: "Request accepted",
              message: acceptedMessage(trainerRows[0]),
              relatedEntityType: "pt_relationship",
              relatedEntityId: row.id,
              data: { deepLink: ACCEPTED_DEEP_LINK },
            },
            tx,
          );

          await auditTrainerAction({
            trainerId: userId,
            clientId: row.clientId,
            actionType: "client_request_accepted",
            targetTable: "pt_client_relationships",
            targetRowId: row.id,
            payload: {},
            tx,
          });

          return {
            data: {
              success: true,
              relationshipId: row.id,
              clientId: row.clientId,
              status: row.status,
            },
            clientId: row.clientId,
            notification,
          };
        },
      );

      if ("data" in result) {
        // Post-commit, best-effort: never throws, never fails the accept.
        await new NotificationDispatcher().dispatchExisting(
          result.clientId,
          result.notification,
        );
        return { data: result.data };
      }

      // 404 — ctx.set.status was set inside the transaction.
      return result;
    },
    {
      params: t.Object({ relationshipId: t.String({ minLength: 1 }) }),
      body: t.Object({
        action: t.Union([t.Literal("accept"), t.Literal("decline")]),
      }),
    },
  );
