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

/**
 * POST /trainers/accept-invite-code — client enters a trainer's invite code
 * to create a relationship. No trainer-role gate (this is the client action).
 *
 * Body: { code: string }
 *
 * Validates the code is active + not expired, creates a pending relationship,
 * marks the code as used.
 */
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

      return db.transaction(async (tx) => {
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
          (existingRel.status === "active" || existingRel.status === "pending")
        ) {
          ctx.set.status = 409;
          return {
            code: "exists",
            message: "You already have a relationship with this trainer",
          };
        }

        // Get trainer name for the response
        const trainerRows = await tx
          .select({ fullName: profiles.fullName })
          .from(profiles)
          .where(eq(profiles.id, trainerId))
          .limit(1);
        const trainerName = trainerRows[0]?.fullName ?? "Your trainer";

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

        ctx.set.status = 201;
        return {
          data: {
            success: true,
            relationshipId,
            trainerName,
            message: `Training request sent to ${trainerName}`,
          },
        };
      });
    },
    {
      body: t.Object({
        code: t.String({ minLength: 1, maxLength: 10 }),
      }),
    },
  );
