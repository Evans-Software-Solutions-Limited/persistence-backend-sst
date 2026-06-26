import Elysia from "elysia";
import { and, eq, sql } from "drizzle-orm";
import { trainerInviteCodes, profiles } from "@persistence/db";
import { getDb } from "@persistence/db/client";
import {
  getAuthUser,
  requireAuth,
  getUser,
} from "@persistence/api-utils/auth/supabaseAuth";

/**
 * POST /trainers/me/invite-codes — generate a short invite code for a client
 * to join without email lookup. Trainer-role-gated. The code expires in 24h
 * and is single-use. Only one active code per trainer at a time.
 */

function generateCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I/O/0/1 for clarity
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export const trainersInviteCodeCreateHandler = new Elysia()
  .derive(async ({ headers }) => ({
    user: await getAuthUser(headers.authorization),
  }))
  .onBeforeHandle(requireAuth)
  .post("/trainers/me/invite-codes", async (ctx) => {
    const { sub: userId } = getUser(ctx);
    const db = getDb();

    // Trainer gate
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
      return { message: "Forbidden" };
    }

    // Expire any stale active codes for this trainer first
    await db
      .update(trainerInviteCodes)
      .set({ status: "expired" })
      .where(
        and(
          eq(trainerInviteCodes.trainerId, userId),
          eq(trainerInviteCodes.status, "active"),
          sql`${trainerInviteCodes.expiresAt} <= NOW()`,
        ),
      );

    // Check if there's already an active (unexpired) code
    const existing = await db
      .select({
        id: trainerInviteCodes.id,
        code: trainerInviteCodes.code,
        expiresAt: trainerInviteCodes.expiresAt,
      })
      .from(trainerInviteCodes)
      .where(
        and(
          eq(trainerInviteCodes.trainerId, userId),
          eq(trainerInviteCodes.status, "active"),
          sql`${trainerInviteCodes.expiresAt} > NOW()`,
        ),
      )
      .limit(1);

    if (existing[0]) {
      // Return the existing active code rather than creating a new one
      return {
        data: {
          id: existing[0].id,
          code: existing[0].code,
          expiresAt: existing[0].expiresAt.toISOString(),
          isExisting: true,
        },
      };
    }

    // Generate a new code (retry on collision with the unique index)
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    let attempts = 0;
    while (attempts < 5) {
      const code = generateCode();
      try {
        const inserted = await db
          .insert(trainerInviteCodes)
          .values({
            trainerId: userId,
            code,
            status: "active",
            expiresAt,
          })
          .returning({
            id: trainerInviteCodes.id,
            code: trainerInviteCodes.code,
            expiresAt: trainerInviteCodes.expiresAt,
          });

        ctx.set.status = 201;
        return {
          data: {
            id: inserted[0].id,
            code: inserted[0].code,
            expiresAt: inserted[0].expiresAt.toISOString(),
            isExisting: false,
          },
        };
      } catch (err) {
        // Unique constraint violation — regenerate
        if (
          err instanceof Error &&
          err.message.includes("unique") 
        ) {
          attempts++;
          continue;
        }
        throw err;
      }
    }

    ctx.set.status = 500;
    return { message: "Failed to generate a unique invite code" };
  });
