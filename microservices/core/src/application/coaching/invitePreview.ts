import { and, desc, eq, gt, isNull } from "drizzle-orm";
import {
  coachClientProfiles,
  coachClientSetupItems,
  profiles,
  trainerInviteCodes,
} from "@persistence/db";
import { getDb } from "@persistence/db/client";
import { buildAcceptPreview, type AcceptPreview } from "./setupSections";

/**
 * `GET /invites/:code/preview` (PER-108, design A D3): what an athlete sees
 * before accepting a code. A personal code shows the coach's prepared set-up
 * through the same projection as the coach's own preview; a general code
 * shows only the coach.
 */
export interface InvitePreview {
  kind: "personal" | "general";
  coach: { name: string; avatarUrl: string | null };
  ready: AcceptPreview | null;
  expiresAt: string;
}

export async function previewInviteCode(
  rawCode: string,
): Promise<InvitePreview | null> {
  const code = rawCode.toUpperCase().trim();
  if (!/^[A-Z0-9]{1,10}$/.test(code)) return null;
  const db = getDb();
  const rows = await db
    .select({
      trainerId: trainerInviteCodes.trainerId,
      clientProfileId: trainerInviteCodes.clientProfileId,
      expiresAt: trainerInviteCodes.expiresAt,
      name: profiles.fullName,
      avatarUrl: profiles.avatarUrl,
    })
    .from(trainerInviteCodes)
    .innerJoin(profiles, eq(profiles.id, trainerInviteCodes.trainerId))
    .where(
      and(
        eq(trainerInviteCodes.code, code),
        eq(trainerInviteCodes.status, "active"),
        gt(trainerInviteCodes.expiresAt, new Date()),
        isNull(profiles.deletedAt),
      ),
    )
    .orderBy(desc(trainerInviteCodes.createdAt))
    .limit(1);
  const row = rows[0];
  if (!row) return null;

  const coach = { name: row.name ?? "Your coach", avatarUrl: row.avatarUrl };
  const expiresAt = row.expiresAt.toISOString();
  if (!row.clientProfileId) {
    return { kind: "general", coach, ready: null, expiresAt };
  }

  const profile = await db
    .select({ id: coachClientProfiles.id })
    .from(coachClientProfiles)
    .where(
      and(
        eq(coachClientProfiles.id, row.clientProfileId),
        eq(coachClientProfiles.trainerId, row.trainerId),
        eq(coachClientProfiles.status, "invited"),
        isNull(coachClientProfiles.deletedAt),
      ),
    )
    .limit(1);
  if (!profile[0]) return null;

  const items = await db
    .select()
    .from(coachClientSetupItems)
    .where(eq(coachClientSetupItems.profileId, row.clientProfileId));
  return {
    kind: "personal",
    coach,
    ready: await buildAcceptPreview(db, items),
    expiresAt,
  };
}
