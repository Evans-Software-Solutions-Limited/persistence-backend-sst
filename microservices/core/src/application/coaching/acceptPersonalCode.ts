import { and, desc, eq, isNotNull, isNull, or, sql } from "drizzle-orm";
import {
  coachClientProfiles,
  coachClientSetupItems,
  profiles,
  ptClientRelationships,
  trainerClientNotes,
  trainerInviteCodes,
  type CoachClientProfile,
  type NewPtClientRelationship,
} from "@persistence/db";
import type { DbOrTx } from "../repositories/personalRecordsRepository";
import type { EntitlementVerdict } from "../entitlement/assertEntitlement";
import { evaluateTrainerJoinSeat } from "../trainers/seats/trainerSeats";
import { recordDataSharingConsent } from "../relationships/recordDataSharingConsent";
import type { DbTransaction } from "../relationships/auditTrainerAction";
import { CoachClientSettingsRepository } from "./clientSettings";
import { generateOnJoin } from "./forms/generators";
import {
  buildAcceptPreview,
  sectionHandler,
  type AcceptPreview,
  type SetupSection,
} from "./setupSections";

/**
 * Accepting a PERSONAL invite code inside `POST /trainers/accept-invite-code`
 * (PER-108, design A D4). The request and its checks are today's: consent,
 * self-invite, an existing relationship → 409 `exists`, the seat cap. What
 * differs from a general code, all in the caller's transaction:
 *
 *   1. the code row is locked and must be active, unexpired, and its profile
 *      still `invited`;
 *   2. the relationship is created (or a dormant one revived) as ACTIVE, not
 *      pending — the coach already chose this person;
 *   3. consent is recorded with source `personal_invite_redeem`;
 *   4. the code becomes `used` and the profile `active`;
 *   5. per-relationship settings are derived from the set-up;
 *   6. every set-up item is materialised through its area's handler, exactly
 *      once (`materialised_at`), and the private notes become a private
 *      `trainer_client_notes` row.
 *
 * A replay (same athlete, same code, after it was used) returns the first
 * result with no side effects, so a retried request after a lost response is
 * safe. A second request racing the first waits on the row lock, then sees
 * the code used and takes that same replay path.
 */

export interface PersonalCodeRow {
  id: string;
  trainerId: string;
  clientProfileId: string;
  status: string;
  usedBy: string | null;
  expiresAt: Date;
}

/** Find (and lock) a personal code this athlete can redeem or replay. */
export async function findPersonalCode(
  tx: DbOrTx,
  code: string,
  userId: string,
): Promise<PersonalCodeRow | null> {
  const rows = await tx
    .select({
      id: trainerInviteCodes.id,
      trainerId: trainerInviteCodes.trainerId,
      clientProfileId: trainerInviteCodes.clientProfileId,
      status: trainerInviteCodes.status,
      usedBy: trainerInviteCodes.usedBy,
      expiresAt: trainerInviteCodes.expiresAt,
    })
    .from(trainerInviteCodes)
    .where(
      and(
        eq(trainerInviteCodes.code, code),
        isNotNull(trainerInviteCodes.clientProfileId),
        or(
          eq(trainerInviteCodes.status, "active"),
          and(
            eq(trainerInviteCodes.status, "used"),
            eq(trainerInviteCodes.usedBy, userId),
          ),
        ),
      ),
    )
    .orderBy(desc(trainerInviteCodes.createdAt))
    .limit(1)
    .for("update");
  const row = rows[0];
  return row ? { ...row, clientProfileId: row.clientProfileId! } : null;
}

export type PersonalAcceptResult =
  | {
      ok: true;
      replay: boolean;
      relationshipId: string;
      trainerId: string;
      trainerName: string;
      trainerRole: string | null;
      clientName: string;
      ready: AcceptPreview;
      afterCommit: (() => Promise<void>)[];
    }
  | {
      capReject: true;
      trainerId: string;
      verdict: Extract<EntitlementVerdict, { allowed: false }>;
      code: string;
      message: string;
    }
  | { status: number; code: string; message: string };

const INVALID_CODE = {
  status: 404,
  code: "invalid_code",
  message: "Invalid or expired invite code. Ask your trainer for a new one.",
} as const;

async function lockProfile(
  tx: DbOrTx,
  codeRow: PersonalCodeRow,
): Promise<CoachClientProfile | null> {
  const rows = await tx
    .select()
    .from(coachClientProfiles)
    .where(
      and(
        eq(coachClientProfiles.id, codeRow.clientProfileId),
        eq(coachClientProfiles.trainerId, codeRow.trainerId),
        isNull(coachClientProfiles.deletedAt),
      ),
    )
    .limit(1)
    .for("update");
  return rows[0] ?? null;
}

async function trainerIdentity(tx: DbOrTx, trainerId: string) {
  const rows = await tx
    .select({ fullName: profiles.fullName, role: profiles.role })
    .from(profiles)
    .where(eq(profiles.id, trainerId))
    .limit(1);
  return {
    trainerName: rows[0]?.fullName ?? "Your trainer",
    trainerRole: rows[0]?.role ?? null,
  };
}

export async function acceptPersonalCode(
  tx: DbTransaction,
  codeRow: PersonalCodeRow,
  userId: string,
  consentVersion: string,
): Promise<PersonalAcceptResult> {
  const profile = await lockProfile(tx, codeRow);
  if (!profile) return INVALID_CODE;

  // Replay of a code this athlete already redeemed.
  if (codeRow.status === "used") {
    if (
      profile.status !== "active" ||
      profile.clientId !== userId ||
      !profile.relationshipId
    ) {
      return INVALID_CODE;
    }
    const items = await tx
      .select()
      .from(coachClientSetupItems)
      .where(eq(coachClientSetupItems.profileId, profile.id));
    return {
      ok: true,
      replay: true,
      relationshipId: profile.relationshipId,
      trainerId: codeRow.trainerId,
      ...(await trainerIdentity(tx, codeRow.trainerId)),
      clientName: "",
      ready: await buildAcceptPreview(tx, items),
      afterCommit: [],
    };
  }

  // Server-side 7-day expiry, and only while the profile is still invited.
  if (codeRow.expiresAt <= new Date() || profile.status !== "invited") {
    return INVALID_CODE;
  }

  const trainerId = codeRow.trainerId;
  if (trainerId === userId) {
    return {
      status: 400,
      code: "self_invite",
      message: "You cannot join yourself as a client",
    };
  }

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
    return {
      status: 409,
      code: "exists",
      message: "You already have a relationship with this trainer",
    };
  }

  // Seat cap, under the same per-trainer lock as a general code. Nothing has
  // been written yet, so a rejection leaves the code and the set-up intact.
  const trainerRow = await tx
    .select({ id: profiles.id, deletedAt: profiles.deletedAt })
    .from(profiles)
    .where(eq(profiles.id, trainerId))
    .for("update");
  // A coach who soft-deleted their account keeps their codes (restoring the
  // account brings them back), but nobody may join them meanwhile: a personal
  // code would otherwise make an ACTIVE relationship, consent grant and
  // set-up with an account that is going away. The preview already refuses.
  if (!trainerRow[0] || trainerRow[0].deletedAt !== null) {
    return INVALID_CODE;
  }
  const seat = await evaluateTrainerJoinSeat(trainerId, tx);
  if (!seat.allowed) {
    return {
      capReject: true,
      trainerId,
      verdict: seat,
      code: "coach_client_limit_reached",
      message: "This coach's client list is full.",
    };
  }

  const identity = await trainerIdentity(tx, trainerId);
  const now = new Date();

  const claimed = await tx
    .update(trainerInviteCodes)
    .set({ status: "used", usedBy: userId, usedAt: now })
    .where(
      and(
        eq(trainerInviteCodes.id, codeRow.id),
        eq(trainerInviteCodes.status, "active"),
      ),
    )
    .returning({ id: trainerInviteCodes.id });
  if (claimed.length === 0) {
    return {
      status: 409,
      code: "code_already_used",
      message: "This invite code has already been used.",
    };
  }

  // Active straight away. initiated_by = 'trainer': the coach invited this
  // person. A dormant (terminated/inactive) row is revived, as general codes do.
  let relationshipId: string;
  if (existingRel) {
    await tx
      .update(ptClientRelationships)
      .set({
        status: "active",
        initiatedBy: "trainer",
        endDate: null,
        consentGivenAt: now,
        consentVersion,
        clientProfileId: profile.id,
        activatedAt: now,
        updatedAt: now,
      })
      .where(eq(ptClientRelationships.id, existingRel.id));
    relationshipId = existingRel.id;
  } else {
    const inserted = await tx
      .insert(ptClientRelationships)
      .values({
        trainerId,
        clientId: userId,
        status: "active",
        initiatedBy: "trainer",
        relationshipReason: "Joined via personal invite",
        consentGivenAt: now,
        consentVersion,
        clientProfileId: profile.id,
        activatedAt: now,
      } as NewPtClientRelationship)
      .returning({ id: ptClientRelationships.id });
    relationshipId = inserted[0]!.id;
  }

  await recordDataSharingConsent({
    trainerId,
    clientId: userId,
    action: "grant",
    consentVersion,
    source: "personal_invite_redeem",
    tx,
  });

  await tx
    .update(coachClientProfiles)
    .set({
      status: "active",
      clientId: userId,
      relationshipId,
      acceptedAt: now,
      revision: sql`${coachClientProfiles.revision} + 1`,
      updatedAt: now,
    })
    .where(eq(coachClientProfiles.id, profile.id));

  const items = await tx
    .select()
    .from(coachClientSetupItems)
    .where(eq(coachClientSetupItems.profileId, profile.id))
    .orderBy(coachClientSetupItems.section, coachClientSetupItems.sortOrder);

  const programme = items.find((i) => i.section === "programme");
  const sessions = Number(programme?.config.sessionsPerWeek);
  await new CoachClientSettingsRepository().upsertFromSetup(
    tx,
    { relationshipId, trainerId, clientId: userId },
    {
      trackTraining: programme !== undefined,
      trackCalories: items.some((i) => i.section === "nutrition_target"),
      sessionsPerWeek:
        Number.isInteger(sessions) && sessions >= 1 && sessions <= 14
          ? sessions
          : null,
    },
  );

  if (profile.privateNotes) {
    await tx.insert(trainerClientNotes).values({
      trainerId,
      clientId: userId,
      noteType: "general",
      title: "Notes from set-up",
      content: profile.privateNotes,
      isPrivate: true,
    });
  }

  const afterCommit: (() => Promise<void>)[] = [];
  for (const item of items) {
    if (item.materialisedAt) continue;
    const handler = sectionHandler(item.section as SetupSection);
    // A section with no live handler stays unmaterialised; set-up validation
    // never lets one in, so this only guards data written by a later build.
    if (!handler) continue;
    const result = await handler.materialise(
      { tx, trainerId, clientId: userId, relationshipId },
      item,
    );
    await tx
      .update(coachClientSetupItems)
      .set({
        materialisedAt: now,
        materialisedRefId: result.refId,
        updatedAt: now,
      })
      .where(
        and(
          eq(coachClientSetupItems.id, item.id),
          isNull(coachClientSetupItems.materialisedAt),
        ),
      );
    if (result.afterCommit) afterCommit.push(result.afterCommit);
  }

  // PER-116 (design C D2): the coach's all-clients on_join forms, after the
  // set-up's starter forms so a form in both is sent once, in set-up order.
  await generateOnJoin(tx, { trainerId, clientId: userId, relationshipId });

  const clientRows = await tx
    .select({ fullName: profiles.fullName })
    .from(profiles)
    .where(eq(profiles.id, userId))
    .limit(1);

  return {
    ok: true,
    replay: false,
    relationshipId,
    trainerId,
    ...identity,
    clientName: clientRows[0]?.fullName ?? profile.displayName,
    ready: await buildAcceptPreview(tx, items),
    afterCommit,
  };
}
