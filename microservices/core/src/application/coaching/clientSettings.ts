import { and, eq, sql } from "drizzle-orm";
import {
  coachClientSettings,
  type CoachClientSettingsRow,
} from "@persistence/db";
import { getDb } from "@persistence/db/client";
import type { DbOrTx } from "../repositories/personalRecordsRepository";

/**
 * Per-relationship coach settings (PER-108, design A D1 / canvas C3.9).
 *
 * One row per `pt_client_relationships` row, so with several coaches each
 * coach has their own settings for the same athlete and never sees another
 * coach's. Every read and write filters by the caller's `trainer_id` as well as
 * the relationship, so a relationship id alone is never enough.
 */

/** The C3.9 feature switches. A key missing from the stored JSON means on. */
export const FEATURE_KEYS = [
  "nutrition",
  "checkIns",
  "photos",
  "habits",
  "messages",
  "resources",
] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];
export type Features = Record<FeatureKey, boolean>;

export const ALERT_MODES = ["default", "mute", "everything"] as const;
export type AlertMode = (typeof ALERT_MODES)[number];

export interface CoachClientSettingsDTO {
  relationshipId: string;
  clientId: string;
  trackTraining: boolean;
  trackCalories: boolean;
  sessionsPerWeek: number | null;
  features: Features;
  alertMode: AlertMode;
  revision: number;
  /** null while no row exists yet (the defaults are being shown). */
  updatedAt: string | null;
}

export interface SettingsPatch {
  trackTraining?: boolean;
  trackCalories?: boolean;
  sessionsPerWeek?: number | null;
  features?: Record<string, unknown>;
  alertMode?: AlertMode;
}

/** Keep only known keys with boolean values. Unknown keys are dropped. */
export function normaliseFeatures(
  input: Record<string, unknown> | null | undefined,
): Partial<Features> {
  const out: Partial<Features> = {};
  if (!input) return out;
  for (const key of FEATURE_KEYS) {
    if (typeof input[key] === "boolean") out[key] = input[key] as boolean;
  }
  return out;
}

/** Fill in the defaults: every switch is on unless stored as false. */
export function resolveFeatures(
  stored: Record<string, unknown> | null | undefined,
): Features {
  const known = normaliseFeatures(stored);
  return Object.fromEntries(
    FEATURE_KEYS.map((key) => [key, known[key] ?? true]),
  ) as Features;
}

export function settingsDto(
  row: CoachClientSettingsRow | null | undefined,
  relationshipId: string,
  clientId: string,
): CoachClientSettingsDTO {
  return {
    relationshipId,
    clientId,
    trackTraining: row?.trackTraining ?? false,
    trackCalories: row?.trackCalories ?? false,
    sessionsPerWeek: row?.sessionsPerWeek ?? null,
    features: resolveFeatures(row?.features),
    alertMode: (row?.alertMode as AlertMode | undefined) ?? "default",
    revision: row?.revision ?? 1,
    updatedAt: row?.updatedAt ? row.updatedAt.toISOString() : null,
  };
}

export interface RelationshipRef {
  relationshipId: string;
  trainerId: string;
  clientId: string;
}

export type PatchSettingsResult =
  | { ok: true; settings: CoachClientSettingsDTO }
  | { ok: false; conflict: true; current: CoachClientSettingsDTO };

export class CoachClientSettingsRepository {
  /** The caller's settings row for this relationship, or null. */
  async find(
    trainerId: string,
    relationshipId: string,
    db: DbOrTx = getDb(),
  ): Promise<CoachClientSettingsRow | null> {
    const rows = await db
      .select()
      .from(coachClientSettings)
      .where(
        and(
          eq(coachClientSettings.relationshipId, relationshipId),
          eq(coachClientSettings.trainerId, trainerId),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Partial update. `expectedRevision` (offline contract): when present and
   * stale, nothing is written and the current row comes back as a conflict;
   * when absent, the last write wins as it always has.
   */
  async patch(
    ref: RelationshipRef,
    patch: SettingsPatch,
    expectedRevision?: number,
  ): Promise<PatchSettingsResult> {
    return getDb().transaction(async (tx) => {
      // Create the default row first so there is always one row to lock.
      await tx
        .insert(coachClientSettings)
        .values({
          relationshipId: ref.relationshipId,
          trainerId: ref.trainerId,
          clientId: ref.clientId,
        })
        .onConflictDoNothing({ target: coachClientSettings.relationshipId });

      const locked = await tx
        .select()
        .from(coachClientSettings)
        .where(
          and(
            eq(coachClientSettings.relationshipId, ref.relationshipId),
            eq(coachClientSettings.trainerId, ref.trainerId),
          ),
        )
        .for("update")
        .limit(1);
      const current = locked[0];
      if (!current) {
        // The relationship belongs to another coach. resolveCoachScope makes
        // this unreachable; kept as a hard stop rather than an upsert.
        throw new Error("coach_client_settings row is not the caller's");
      }

      if (
        expectedRevision !== undefined &&
        expectedRevision !== current.revision
      ) {
        return {
          ok: false as const,
          conflict: true as const,
          current: settingsDto(current, ref.relationshipId, ref.clientId),
        };
      }

      const features =
        patch.features === undefined
          ? current.features
          : {
              ...normaliseFeatures(current.features),
              ...normaliseFeatures(patch.features),
            };

      const updated = await tx
        .update(coachClientSettings)
        .set({
          trackTraining: patch.trackTraining ?? current.trackTraining,
          trackCalories: patch.trackCalories ?? current.trackCalories,
          sessionsPerWeek:
            patch.sessionsPerWeek === undefined
              ? current.sessionsPerWeek
              : patch.sessionsPerWeek,
          features,
          alertMode: patch.alertMode ?? current.alertMode,
          revision: sql`${coachClientSettings.revision} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(coachClientSettings.relationshipId, ref.relationshipId),
            eq(coachClientSettings.trainerId, ref.trainerId),
          ),
        )
        .returning();

      return {
        ok: true as const,
        settings: settingsDto(updated[0], ref.relationshipId, ref.clientId),
      };
    });
  }

  /**
   * Write the settings a personal-code accept derives from the set-up. On a
   * revived relationship the new set-up replaces what the last coaching cycle
   * left behind.
   */
  async upsertFromSetup(
    tx: DbOrTx,
    ref: RelationshipRef,
    values: {
      trackTraining: boolean;
      trackCalories: boolean;
      sessionsPerWeek: number | null;
    },
  ): Promise<void> {
    await tx
      .insert(coachClientSettings)
      .values({ ...ref, ...values })
      .onConflictDoUpdate({
        target: coachClientSettings.relationshipId,
        set: {
          ...values,
          revision: sql`${coachClientSettings.revision} + 1`,
          updatedAt: new Date(),
        },
      });
  }
}
