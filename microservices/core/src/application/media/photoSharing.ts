import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import {
  dataSharingConsents,
  profiles,
  ptClientRelationships,
} from "@persistence/db";
import { getDb } from "@persistence/db/client";
import type { DbOrTx } from "../repositories/personalRecordsRepository";
import { recordDataSharingConsent } from "../relationships/recordDataSharingConsent";

/**
 * The one-time photo-sharing consent (PER-121, backend design F).
 *
 * Photos are a data type today's coach consent copy (spec 28) doesn't name,
 * so a coach only sees a client's progress photos after the client confirms
 * "Share progress photos with your coaches". It is stored as one
 * `data_sharing_consents` row per active coach: `action = 'grant'`,
 * `source = 'photo_sharing_prompt'`.
 *
 * A grant only counts for the CURRENT coaching cycle: it must be newer than
 * the relationship's `activated_at` and than the pair's latest `withdraw`
 * (leaving or removing a coach writes one). So a coach who stops coaching and
 * is later re-accepted needs the client to confirm again.
 *
 * AI coach relationships (`is_ai_trainer`) are never offered or granted:
 * photos never reach AI (Brad, 20 Nov 2026).
 */

export const PHOTO_SHARING_SOURCE = "photo_sharing_prompt" as const;

/**
 * Stamped on every photo-sharing grant, recording which wording the athlete
 * agreed to. It is a record only: `grantedTrainers` matches grants on
 * action, source and coaching cycle, never on this version, so a grant
 * stamped with an older version (e.g. `photos-v0-placeholder`) still counts
 * and nobody is asked again when it changes.
 * v1 (26 Nov 2026): Brad's approved wording below (PER-137).
 */
export const PHOTO_SHARING_CONSENT_VERSION = "photos-v1";

/**
 * The one-time prompt's wording, approved by Brad on 26 Nov 2026 (PER-137,
 * design F "Consent"). The app shows the text this API serves.
 */
export const PHOTO_SHARING_COPY =
  "Share your progress photos with your coaches. Only your current coaches can see them, and they lose access when coaching ends.";

export interface PhotoSharingCoach {
  trainerId: string;
  name: string | null;
  sharing: boolean;
}

export interface PhotoSharingStatus {
  /** True while any active coach doesn't have a current grant. */
  needsPrompt: boolean;
  coaches: PhotoSharingCoach[];
  consentVersion: string;
  copy: string;
}

interface ActiveCoach {
  trainerId: string;
  name: string | null;
  activatedAt: Date | null;
}

async function activeCoaches(
  db: DbOrTx,
  clientId: string,
): Promise<ActiveCoach[]> {
  return db
    .select({
      trainerId: ptClientRelationships.trainerId,
      name: profiles.fullName,
      activatedAt: ptClientRelationships.activatedAt,
    })
    .from(ptClientRelationships)
    .innerJoin(profiles, eq(profiles.id, ptClientRelationships.trainerId))
    .where(
      and(
        eq(ptClientRelationships.clientId, clientId),
        eq(ptClientRelationships.status, "active"),
        eq(ptClientRelationships.isAiTrainer, false),
        isNull(profiles.deletedAt),
      ),
    )
    .orderBy(ptClientRelationships.createdAt);
}

/** Which of these coaches hold a photo grant for the current cycle. */
async function grantedTrainers(
  db: DbOrTx,
  clientId: string,
  coaches: ActiveCoach[],
): Promise<Set<string>> {
  if (coaches.length === 0) return new Set();
  const rows = await db
    .select({
      trainerId: dataSharingConsents.trainerId,
      action: dataSharingConsents.action,
      source: dataSharingConsents.source,
      createdAt: dataSharingConsents.createdAt,
    })
    .from(dataSharingConsents)
    .where(
      and(
        eq(dataSharingConsents.clientId, clientId),
        inArray(
          dataSharingConsents.trainerId,
          coaches.map((c) => c.trainerId),
        ),
      ),
    )
    .orderBy(desc(dataSharingConsents.createdAt));
  const granted = new Set<string>();
  for (const coach of coaches) {
    // Newest first: the first withdraw ends every older grant.
    for (const row of rows) {
      if (row.trainerId !== coach.trainerId) continue;
      if (row.action === "withdraw") break;
      if (
        row.action === "grant" &&
        row.source === PHOTO_SHARING_SOURCE &&
        (!coach.activatedAt || row.createdAt >= coach.activatedAt)
      ) {
        granted.add(coach.trainerId);
        break;
      }
    }
  }
  return granted;
}

function status(
  coaches: ActiveCoach[],
  granted: Set<string>,
): PhotoSharingStatus {
  const list = coaches.map((c) => ({
    trainerId: c.trainerId,
    name: c.name,
    sharing: granted.has(c.trainerId),
  }));
  return {
    needsPrompt: list.some((c) => !c.sharing),
    coaches: list,
    consentVersion: PHOTO_SHARING_CONSENT_VERSION,
    copy: PHOTO_SHARING_COPY,
  };
}

export async function photoSharingStatus(
  clientId: string,
): Promise<PhotoSharingStatus> {
  const db = getDb();
  const coaches = await activeCoaches(db, clientId);
  return status(coaches, await grantedTrainers(db, clientId, coaches));
}

/**
 * The client confirms the prompt: one grant row for every active coach that
 * doesn't already hold one for this cycle. Idempotent (a repeat writes
 * nothing). Locks the client's active relationships so two taps can't both
 * write.
 */
export async function grantPhotoSharing(
  clientId: string,
): Promise<PhotoSharingStatus> {
  return getDb().transaction(async (tx) => {
    await tx
      .select({ id: ptClientRelationships.id })
      .from(ptClientRelationships)
      .where(
        and(
          eq(ptClientRelationships.clientId, clientId),
          eq(ptClientRelationships.status, "active"),
        ),
      )
      .for("update");
    const coaches = await activeCoaches(tx, clientId);
    const granted = await grantedTrainers(tx, clientId, coaches);
    for (const coach of coaches) {
      if (granted.has(coach.trainerId)) continue;
      await recordDataSharingConsent({
        trainerId: coach.trainerId,
        clientId,
        action: "grant",
        consentVersion: PHOTO_SHARING_CONSENT_VERSION,
        source: PHOTO_SHARING_SOURCE,
        tx,
      });
      granted.add(coach.trainerId);
    }
    return status(coaches, granted);
  });
}

/** Does this coach hold a current photo grant from this client? */
export async function coachHasPhotoConsent(
  trainerId: string,
  clientId: string,
): Promise<boolean> {
  const db = getDb();
  const coaches = (await activeCoaches(db, clientId)).filter(
    (c) => c.trainerId === trainerId,
  );
  return (await grantedTrainers(db, clientId, coaches)).has(trainerId);
}
