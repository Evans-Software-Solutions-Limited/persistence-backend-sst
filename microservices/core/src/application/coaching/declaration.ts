import { and, desc, eq } from "drizzle-orm";
import { trainerDeclarations } from "@persistence/db";
import { getDb } from "@persistence/db/client";
import type { DbOrTx } from "../repositories/personalRecordsRepository";

/**
 * The coach declaration (PER-108, design A D6b; Brad, 20 Nov).
 *
 * Before inviting their first client through the NEW personal-invite route, a
 * coach confirms a dated statement: they hold suitable qualifications and
 * insurance, and they are responsible for screening their clients. Brad writes
 * the wording; the text ships in the app and its hash is stored on the row.
 *
 * The platform verifies nothing, and no response ever claims a coach is
 * "verified". Today's `POST /trainers/me/invite-codes` and email invites are NOT
 * gated, so 1.2.0 coach bundles keep working.
 */

/**
 * Used when `COACH_DECLARATION_VERSION` isn't set for the stage. Bumping the
 * version (env or this default) asks every coach again on their next invite.
 */
export const DEFAULT_COACH_DECLARATION_VERSION = "2026-11-v1";

export function currentDeclarationVersion(): string {
  const fromEnv = process.env.COACH_DECLARATION_VERSION?.trim();
  return fromEnv ? fromEnv : DEFAULT_COACH_DECLARATION_VERSION;
}

export interface DeclarationStatus {
  currentVersion: string;
  /** The most recent version this coach accepted, or null. */
  acceptedVersion: string | null;
  acceptedAt: string | null;
}

export async function getDeclarationStatus(
  trainerId: string,
  db: DbOrTx = getDb(),
): Promise<DeclarationStatus> {
  const currentVersion = currentDeclarationVersion();
  const current = await db
    .select({
      version: trainerDeclarations.statementVersion,
      acceptedAt: trainerDeclarations.acceptedAt,
    })
    .from(trainerDeclarations)
    .where(
      and(
        eq(trainerDeclarations.trainerId, trainerId),
        eq(trainerDeclarations.statementVersion, currentVersion),
      ),
    )
    .limit(1);
  const row =
    current[0] ??
    (
      await db
        .select({
          version: trainerDeclarations.statementVersion,
          acceptedAt: trainerDeclarations.acceptedAt,
        })
        .from(trainerDeclarations)
        .where(eq(trainerDeclarations.trainerId, trainerId))
        .orderBy(desc(trainerDeclarations.acceptedAt))
        .limit(1)
    )[0];
  return {
    currentVersion,
    acceptedVersion: row?.version ?? null,
    acceptedAt: row?.acceptedAt ? row.acceptedAt.toISOString() : null,
  };
}

export async function hasAcceptedCurrentDeclaration(
  trainerId: string,
  db: DbOrTx = getDb(),
): Promise<boolean> {
  const status = await getDeclarationStatus(trainerId, db);
  return status.acceptedVersion === status.currentVersion;
}

export type AcceptDeclarationResult =
  | { ok: true; status: DeclarationStatus }
  | { ok: false; code: "declaration_version_mismatch"; currentVersion: string };

/**
 * Record acceptance of the CURRENT version. Idempotent: accepting a version
 * twice, or replaying the same Idempotency-Key, keeps the first row.
 */
export async function acceptDeclaration(
  trainerId: string,
  input: { statementVersion: string; statementTextHash?: string },
  clientRequestId: string | null,
): Promise<AcceptDeclarationResult> {
  const currentVersion = currentDeclarationVersion();
  if (input.statementVersion !== currentVersion) {
    return { ok: false, code: "declaration_version_mismatch", currentVersion };
  }
  const db = getDb();
  await db
    .insert(trainerDeclarations)
    .values({
      trainerId,
      statementVersion: input.statementVersion,
      statementTextHash: input.statementTextHash?.toLowerCase() ?? null,
      clientRequestId,
    })
    .onConflictDoNothing();
  return { ok: true, status: await getDeclarationStatus(trainerId, db) };
}
