import Elysia, { t } from "elysia";
import { and, eq, sql } from "drizzle-orm";
import {
  trainerInviteCodes,
  ptClientRelationships,
  profiles,
  type NewPtClientRelationship,
} from "@persistence/db";
import { getDb } from "@persistence/db/client";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";
import { NotificationDispatcher } from "../../notifications/push/notificationDispatcher";

/**
 * POST /trainers/accept-invite-code — client enters a trainer's invite code
 * to create a relationship. No trainer-role gate (this is the client action).
 *
 * Body: { code: string }
 *
 * Validates the code is active + not expired, creates a pending relationship,
 * marks the code as used.
 *
 * Notifications: this flow is CLIENT-initiated (the client redeems the
 * trainer's code), so the trainer is the party who must review/accept the
 * request. The shared `create_pt_relationship_notifications` Postgres trigger
 * only covers the trainer-initiated email flow (it notifies the client on a
 * pending INSERT), so the trainer would otherwise receive nothing. We emit a
 * `pt_request` / `physio_request` notification to the trainer here, AFTER the
 * transaction commits, so a rollback never leaves an orphan notification.
 */
/**
 * Discriminated result of the accept-invite-code transaction: either the
 * success shape (carrying the fields needed to emit the trainer notification
 * post-commit) or a `{ code, message }` error body. The explicit union lets
 * `"ok" in result` narrow cleanly so the success fields are non-optional.
 */
type AcceptInviteCodeTxResult =
  | {
      ok: true;
      relationshipId: string;
      trainerId: string;
      trainerName: string;
      trainerRole: string | null;
      clientName: string;
    }
  | { code: string; message: string };

export const trainersAcceptInviteCodeHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .post(
    "/trainers/accept-invite-code",
    async (ctx) => {
      const { sub: userId } = getUser(ctx);
      const db = getDb();
      const { code } = ctx.body as { code: string };
      const normalizedCode = code.toUpperCase().trim();

      const result = await db.transaction(
        async (tx): Promise<AcceptInviteCodeTxResult> => {
          // Find the active, unexpired code
          const codeRows = await tx
            .select({
              id: trainerInviteCodes.id,
              trainerId: trainerInviteCodes.trainerId,
            })
            .from(trainerInviteCodes)
            .where(
              and(
                eq(trainerInviteCodes.code, normalizedCode),
                eq(trainerInviteCodes.status, "active"),
                sql`${trainerInviteCodes.expiresAt} > NOW()`,
              ),
            )
            .limit(1);

          const inviteCode = codeRows[0];
          if (!inviteCode) {
            ctx.set.status = 404;
            return {
              code: "invalid_code",
              message:
                "Invalid or expired invite code. Ask your trainer for a new one.",
            };
          }

          const trainerId = inviteCode.trainerId;

          // Self-join guard
          if (trainerId === userId) {
            ctx.set.status = 400;
            return {
              code: "self_invite",
              message: "You cannot join yourself as a client",
            };
          }

          // Check if relationship already exists
          const existing = await tx
            .select({
              id: ptClientRelationships.id,
              status: ptClientRelationships.status,
            })
            .from(ptClientRelationships)
            .where(
              and(
                eq(ptClientRelationships.trainerId, trainerId),
                eq(ptClientRelationships.clientId, userId),
              ),
            )
            .limit(1);

          const existingRel = existing[0];
          if (
            existingRel &&
            (existingRel.status === "active" ||
              existingRel.status === "pending")
          ) {
            ctx.set.status = 409;
            return {
              code: "exists",
              message: "You already have a relationship with this trainer",
            };
          }

          // Get trainer name + role for the response and notification. Role
          // picks `physio_request` vs `pt_request`; it may be null/undefined in
          // unit tests, which falls back to the personal-trainer copy.
          const trainerRows = await tx
            .select({ fullName: profiles.fullName, role: profiles.role })
            .from(profiles)
            .where(eq(profiles.id, trainerId))
            .limit(1);
          const trainerName = trainerRows[0]?.fullName ?? "Your trainer";
          const trainerRole = trainerRows[0]?.role ?? null;

          // Atomically claim the code BEFORE creating the relationship. The
          // `status = 'active'` guard + rowcount check closes the TOCTOU window:
          // if two clients submit the same code concurrently, only the UPDATE
          // that flips 'active' → 'used' returns a row; the loser gets 0 rows
          // and is rejected, so the code can never be redeemed twice.
          const claimed = await tx
            .update(trainerInviteCodes)
            .set({
              status: "used",
              usedBy: userId,
              usedAt: new Date(),
            })
            .where(
              and(
                eq(trainerInviteCodes.id, inviteCode.id),
                eq(trainerInviteCodes.status, "active"),
              ),
            )
            .returning({ id: trainerInviteCodes.id });

          if (claimed.length === 0) {
            ctx.set.status = 409;
            return {
              code: "code_already_used",
              message: "This invite code has already been used.",
            };
          }

          // Create or revive the relationship
          let relationshipId: string;
          if (existingRel) {
            // Revive dormant relationship
            await tx
              .update(ptClientRelationships)
              .set({
                status: "pending",
                endDate: null,
                updatedAt: new Date(),
              })
              .where(eq(ptClientRelationships.id, existingRel.id));
            relationshipId = existingRel.id;
          } else {
            const inserted = await tx
              .insert(ptClientRelationships)
              .values({
                trainerId,
                clientId: userId,
                status: "pending",
                relationshipReason: "Joined via invite code",
              } as NewPtClientRelationship)
              .returning({ id: ptClientRelationships.id });
            relationshipId = inserted[0].id;
          }

          // Client display name for the trainer-facing notification copy.
          const clientRows = await tx
            .select({ fullName: profiles.fullName })
            .from(profiles)
            .where(eq(profiles.id, userId))
            .limit(1);
          const clientName = clientRows[0]?.fullName ?? "A new client";

          ctx.set.status = 201;
          return {
            ok: true as const,
            relationshipId,
            trainerId,
            trainerName,
            trainerRole,
            clientName,
          };
        },
      );

      // Emit the trainer-facing request notification AFTER the transaction
      // commits, so a rollback can't leave an orphan notification. Best-effort:
      // a notification failure must not fail an otherwise-successful join — the
      // relationship already exists and the trainer can still see it.
      if ("ok" in result) {
        const isPhysio = result.trainerRole === "physiotherapist";
        try {
          await new NotificationDispatcher().createAndDispatch(
            result.trainerId,
            {
              type: isPhysio ? "physio_request" : "pt_request",
              title: isPhysio ? "New physio request" : "New training request",
              message: `${result.clientName} joined via your invite code`,
              relatedEntityType: "pt_relationship",
              relatedEntityId: result.relationshipId,
              data: {
                // Deeplink to the trainer's OWN clients roster (the pending
                // client shows there). NOT the Requests screen — that's
                // client-scoped (GET /clients/me/relationships filters on
                // client_id = viewer), so a trainer would land on an empty list.
                deeplink: `persistencemobile://clients?clientId=${userId}`,
                relationship_id: result.relationshipId,
                client_id: userId,
              },
            },
          );
        } catch (err) {
          console.error(
            "[accept-invite-code] failed to emit trainer notification",
            err,
          );
        }

        return {
          data: {
            success: true,
            relationshipId: result.relationshipId,
            trainerName: result.trainerName,
            message: `Training request sent to ${result.trainerName}`,
          },
        };
      }

      // Error result: ctx.set.status was already set inside the transaction.
      return result;
    },
    {
      body: t.Object({
        code: t.String({ minLength: 1, maxLength: 10 }),
      }),
    },
  );
