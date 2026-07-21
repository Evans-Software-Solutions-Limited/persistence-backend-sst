import Elysia, { t } from "elysia";
import { and, eq } from "drizzle-orm";
import { ptClientRelationships, profiles } from "@persistence/db";
import { getDb } from "@persistence/db/client";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";
import type { EntitlementVerdict } from "../../entitlement/assertEntitlement";
import {
  evaluateTrainerClientsActiveSeat,
  notifyTrainerClientLimitReached,
} from "../seats/trainerSeats";
import { recordDataSharingConsent } from "../../relationships/recordDataSharingConsent";

/**
 * Discriminated result of the accept transaction: success, a client-slot cap
 * rejection (carrying the trainer + verdict for the post-commit notification),
 * or a plain 404. The explicit union lets `"capReject" in result` /
 * `"data" in result` narrow cleanly.
 */
type RespondAcceptTxResult =
  | {
      data: {
        success: true;
        relationshipId: string;
        trainerId: string;
        status: string | null;
      };
    }
  | {
      capReject: true;
      trainerId: string;
      verdict: Extract<EntitlementVerdict, { allowed: false }>;
      code: string;
      message: string;
    }
  | { code: string; message: string };

/**
 * POST /clients/me/relationships/:relationshipId/respond — the CLIENT accepts
 * or declines a pending trainer request.
 *
 * Body: { action: "accept" | "decline", consent?: boolean, consentVersion?: string }
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
 *
 * 26-coach-data-sharing-consent: `accept` is the point the CLIENT agrees to
 * share their health data with this coach (UK GDPR Art 9(2)(a) explicit
 * consent). `consent:true` + a non-empty `consentVersion` are REQUIRED on
 * accept — missing either 400s with `consent_required` and activates
 * nothing. On a successful accept, in the SAME transaction that flips
 * pending→active: stamp `consent_given_at`/`consent_version` on the row and
 * append a `data_sharing_consents` `grant` row (source `invite_accept`).
 * `decline` needs no consent (nothing is being shared).
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
      const { action, consent, consentVersion } = ctx.body as {
        action: "accept" | "decline";
        consent?: boolean;
        consentVersion?: string;
      };

      // 26-coach-data-sharing-consent: accept is a consent-capture point.
      // Reject BEFORE any DB work (no transaction started, nothing
      // activated) if the client hasn't affirmatively consented.
      if (action === "accept" && (!consent || !consentVersion)) {
        ctx.set.status = 400;
        return {
          code: "consent_required",
          message:
            "Explicit consent to share your data with this coach is required to accept.",
        };
      }

      // Decline never consumes a seat → keep the original single-statement
      // conditional UPDATE (atomic against a concurrent move).
      if (action === "decline") {
        const updated = await db
          .update(ptClientRelationships)
          .set({ status: "terminated", updatedAt: new Date() })
          .where(
            and(
              eq(ptClientRelationships.id, relationshipId),
              eq(ptClientRelationships.clientId, userId),
              eq(ptClientRelationships.status, "pending"),
              // Client-initiated (invite-code) pendings are coach-accepted
              // (Phase 8) — the client can only act on trainer-initiated ones.
              eq(ptClientRelationships.initiatedBy, "trainer"),
            ),
          )
          .returning({
            id: ptClientRelationships.id,
            trainerId: ptClientRelationships.trainerId,
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
        return {
          data: {
            success: true,
            relationshipId: row.id,
            trainerId: row.trainerId,
            status: row.status,
          },
        };
      }

      // Accept = pending → active: the TRUE seat-consumption moment. Enforce
      // the trainer's client-slot cap under a per-trainer row lock so two
      // clients accepting concurrently at cap−1 can't both slip through.
      const result = await db.transaction(
        async (tx): Promise<RespondAcceptTxResult> => {
          // Resolve the pending relationship (ownership-scoped) to get the
          // trainer before locking + counting.
          const relRows = await tx
            .select({
              id: ptClientRelationships.id,
              trainerId: ptClientRelationships.trainerId,
            })
            .from(ptClientRelationships)
            .where(
              and(
                eq(ptClientRelationships.id, relationshipId),
                eq(ptClientRelationships.clientId, userId),
                eq(ptClientRelationships.status, "pending"),
                // Only trainer-initiated pendings are client-accepted (Phase 8).
                eq(ptClientRelationships.initiatedBy, "trainer"),
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
          // accepted is excluded from the active count, so the check is
          // "would activating this row exceed the cap?".
          await tx
            .select({ id: profiles.id })
            .from(profiles)
            .where(eq(profiles.id, rel.trainerId))
            .for("update");

          const seat = await evaluateTrainerClientsActiveSeat(
            rel.trainerId,
            tx,
          );
          if (!seat.allowed) {
            // The client is the actor → 409 conflict, NOT a 402 upsell. Carry
            // the verdict out so the trainer is notified post-commit.
            ctx.set.status = 409;
            return {
              capReject: true as const,
              trainerId: rel.trainerId,
              verdict: seat,
              code: "coach_client_limit_reached",
              message: "This coach's client list is full.",
            };
          }

          // Activate. Conditional on status='pending' still guards a concurrent
          // client-side move (double tap / concurrent decline). The consent
          // stamp rides along on this SAME update (no extra query) — consent
          // + consentVersion were validated non-empty above.
          const updated = await tx
            .update(ptClientRelationships)
            .set({
              status: "active",
              updatedAt: new Date(),
              consentGivenAt: new Date(),
              consentVersion,
            })
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
            ctx.set.status = 404;
            return {
              code: "not_found",
              message: "No pending request found for this relationship",
            };
          }

          // Append-only accountability log (spec 26) — same tx as the stamp.
          await recordDataSharingConsent({
            trainerId: row.trainerId,
            clientId: userId,
            action: "grant",
            consentVersion: consentVersion as string,
            source: "invite_accept",
            tx,
          });

          return {
            data: {
              success: true,
              relationshipId: row.id,
              trainerId: row.trainerId,
              status: row.status,
            },
          };
        },
      );

      // Best-effort trainer notification on a cap rejection (post-commit; the
      // tx made no write). Strip the trainer/verdict fields from the response.
      if ("capReject" in result) {
        await notifyTrainerClientLimitReached(result.trainerId, result.verdict);
        return { code: result.code, message: result.message };
      }

      return result;
    },
    {
      params: t.Object({ relationshipId: t.String({ minLength: 1 }) }),
      body: t.Object({
        action: t.Union([t.Literal("accept"), t.Literal("decline")]),
        // Required (checked at runtime, not schema-level) when action ===
        // "accept" — see 26-coach-data-sharing-consent above. Optional here
        // so a missing/absent value 400s as `consent_required` rather than a
        // generic 422 schema-validation error.
        consent: t.Optional(t.Boolean()),
        consentVersion: t.Optional(t.String()),
      }),
    },
  );
