import { and, asc, desc, eq, gte, inArray, isNull, lt } from "drizzle-orm";
import {
  coachClientSettings,
  nutritionEntries,
  nutritionTargetHistory,
  profiles,
  ptClientRelationships,
  workoutSessions,
} from "@persistence/db";
import { getDb } from "@persistence/db/client";
import { settingsDto } from "../coaching/clientSettings";
import type { CoachScope } from "../relationships/resolveCoachScope";
import {
  localDateIn,
  safeTimeZone,
  type AdherenceInput,
  type AdherenceSettings,
  type AdherenceWindowDays,
  type LocalDate,
} from "./computeAdherence";

/**
 * Assembles `computeAdherence` input (PER-114, design B D2). Reads only; no
 * maths beyond grouping kcal by the athlete's local day.
 *
 * Authorization is the CALLER's job. Per-client coach reads pass a
 * `CoachScope` from `resolveCoachScope` (or call `load` with the relationship
 * id it returned). The roster and overview, which read every client at once,
 * use `subjectsForTrainer`, whose single query applies the same scoping rule
 * as `resolveCoachScope`: the caller's own ACTIVE, non-AI relationships, a
 * client account that isn't deleted, and settings filtered by the caller's
 * `trainer_id` as well as the relationship. Coach A never gets coach B's
 * settings.
 *
 * Every athlete-data query is filtered by the subjects' client ids and bounded
 * to the window (plus a two-day margin for time zones).
 */

/** One client as one coach sees them. */
export interface AdherenceSubject {
  clientId: string;
  relationshipId: string;
  settings: AdherenceSettings;
  /** pt_client_relationships.activated_at */
  activatedAt: Date | string | null;
}

/** A `nutrition_target_history` row, numbers as numbers. */
export interface TargetHistoryRow {
  userId: string;
  dailyKcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  setByUserId: string | null;
  effectiveAt: Date;
}

export type AdherenceWindow = "7d" | "28d";

export const WINDOW_DAYS: Record<AdherenceWindow, AdherenceWindowDays> = {
  "7d": 7,
  "28d": 28,
};

const DAY_MS = 86_400_000;

/** The oldest instant any window day can start at, with time-zone slack. */
export function lowerBound(now: Date, windowDays: number): Date {
  return new Date(now.getTime() - (windowDays + 2) * DAY_MS);
}

function toDate(value: Date | string | null): Date | null {
  if (value === null) return null;
  return value instanceof Date ? value : new Date(value);
}

export class AdherenceRepository {
  static readonly key = "AdherenceRepository";

  /**
   * Design B's `AdherenceRepository.load(clientId, relationshipId, window)`.
   * `relationshipId` must come from `resolveCoachScope` for this client. Reads
   * that relationship (still active, same client) and its settings under its
   * own coach's id. null when the relationship isn't active any more.
   */
  async load(
    clientId: string,
    relationshipId: string,
    window: AdherenceWindow,
    now: Date = new Date(),
  ): Promise<AdherenceInput | null> {
    const rows = await getDb()
      .select({
        relationshipId: ptClientRelationships.id,
        clientId: ptClientRelationships.clientId,
        activatedAt: ptClientRelationships.activatedAt,
        settings: coachClientSettings,
      })
      .from(ptClientRelationships)
      .leftJoin(
        coachClientSettings,
        and(
          eq(coachClientSettings.relationshipId, ptClientRelationships.id),
          eq(coachClientSettings.trainerId, ptClientRelationships.trainerId),
        ),
      )
      .where(
        and(
          eq(ptClientRelationships.id, relationshipId),
          eq(ptClientRelationships.clientId, clientId),
          eq(ptClientRelationships.status, "active"),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    const subject: AdherenceSubject = {
      clientId,
      relationshipId,
      settings: settingsDto(row.settings, relationshipId, clientId),
      activatedAt: row.activatedAt,
    };
    const inputs = await this.loadMany([subject], window, now);
    return inputs.get(relationshipId)!;
  }

  /** `load` for a scope `resolveCoachScope` has just returned (no re-read). */
  async loadForScope(
    scope: CoachScope,
    window: AdherenceWindow,
    now: Date = new Date(),
  ): Promise<AdherenceInput> {
    const subject: AdherenceSubject = {
      clientId: scope.clientId,
      relationshipId: scope.relationshipId,
      settings: scope.settings,
      activatedAt: scope.activatedAt,
    };
    const inputs = await this.loadMany([subject], window, now);
    return inputs.get(scope.relationshipId)!;
  }

  /**
   * The caller's active, non-AI clients with their own settings for each, in
   * one query. Optionally narrowed to `clientIds` (the roster's).
   */
  async subjectsForTrainer(
    trainerId: string,
    clientIds?: string[],
  ): Promise<AdherenceSubject[]> {
    if (clientIds && clientIds.length === 0) return [];
    const rows = await getDb()
      .select({
        relationshipId: ptClientRelationships.id,
        clientId: ptClientRelationships.clientId,
        activatedAt: ptClientRelationships.activatedAt,
        settings: coachClientSettings,
      })
      .from(ptClientRelationships)
      .innerJoin(profiles, eq(profiles.id, ptClientRelationships.clientId))
      .leftJoin(
        coachClientSettings,
        and(
          eq(coachClientSettings.relationshipId, ptClientRelationships.id),
          eq(coachClientSettings.trainerId, trainerId),
        ),
      )
      .where(
        and(
          eq(ptClientRelationships.trainerId, trainerId),
          eq(ptClientRelationships.status, "active"),
          eq(ptClientRelationships.isAiTrainer, false),
          isNull(profiles.deletedAt),
          ...(clientIds
            ? [inArray(ptClientRelationships.clientId, clientIds)]
            : []),
        ),
      );
    return rows.map((r) => ({
      clientId: r.clientId,
      relationshipId: r.relationshipId,
      settings: settingsDto(r.settings, r.relationshipId, r.clientId),
      activatedAt: r.activatedAt,
    }));
  }

  /**
   * Inputs for many subjects, keyed by relationship id. Only the areas some
   * subject tracks are read, each in one query over all their clients.
   */
  async loadMany(
    subjects: AdherenceSubject[],
    window: AdherenceWindow,
    now: Date = new Date(),
  ): Promise<Map<string, AdherenceInput>> {
    const out = new Map<string, AdherenceInput>();
    if (subjects.length === 0) return out;
    const windowDays = WINDOW_DAYS[window];
    const since = lowerBound(now, windowDays);

    const allIds = [...new Set(subjects.map((s) => s.clientId))];
    const trainingIds = [
      ...new Set(
        subjects.filter((s) => s.settings.trackTraining).map((s) => s.clientId),
      ),
    ];
    const calorieIds = [
      ...new Set(
        subjects.filter((s) => s.settings.trackCalories).map((s) => s.clientId),
      ),
    ];

    const [zones, sessions, entries, targets] = await Promise.all([
      this.timeZones(allIds),
      this.completedSessions(trainingIds, since),
      this.entries(calorieIds, since),
      this.targetsInForceSince(calorieIds, since),
    ]);

    const dayKcalByClient = new Map<string, Map<LocalDate, number>>();
    for (const e of entries) {
      const tz = zones.get(e.userId)!;
      const byDay =
        dayKcalByClient.get(e.userId) ?? new Map<LocalDate, number>();
      const day = localDateIn(e.loggedAt, tz);
      byDay.set(day, (byDay.get(day) ?? 0) + e.kcal);
      dayKcalByClient.set(e.userId, byDay);
    }

    for (const s of subjects) {
      const timeZone = zones.get(s.clientId)!;
      const activated = toDate(s.activatedAt);
      out.set(s.relationshipId, {
        timeZone,
        now,
        coachingStart: activated ? localDateIn(activated, timeZone) : null,
        settings: {
          trackTraining: s.settings.trackTraining,
          trackCalories: s.settings.trackCalories,
          sessionsPerWeek: s.settings.sessionsPerWeek,
        },
        sessions: s.settings.trackTraining
          ? (sessions.get(s.clientId) ?? [])
          : [],
        dayKcal: s.settings.trackCalories
          ? (dayKcalByClient.get(s.clientId) ?? new Map())
          : new Map(),
        targets: s.settings.trackCalories
          ? (targets.get(s.clientId) ?? []).map((t) => ({
              effectiveAt: t.effectiveAt,
              dailyKcal: t.dailyKcal,
            }))
          : [],
        windowDays,
      });
    }
    return out;
  }

  /**
   * `nutrition_target_history` for these users from `since` onwards, plus the
   * row in force at `since` (the latest one before it), oldest first. Pass the
   * signed-in user's id for a self read, or ids a coach scope has cleared.
   * Resolve a day's target with `targetResolver` from computeAdherence.
   */
  async targetsInForceSince(
    userIds: string[],
    since: Date,
  ): Promise<Map<string, TargetHistoryRow[]>> {
    const out = new Map<string, TargetHistoryRow[]>();
    if (userIds.length === 0) return out;
    const db = getDb();
    const columns = {
      userId: nutritionTargetHistory.userId,
      dailyKcal: nutritionTargetHistory.dailyKcal,
      proteinG: nutritionTargetHistory.proteinG,
      carbsG: nutritionTargetHistory.carbsG,
      fatG: nutritionTargetHistory.fatG,
      setByUserId: nutritionTargetHistory.setByUserId,
      effectiveAt: nutritionTargetHistory.effectiveAt,
    };
    const [before, after] = await Promise.all([
      db
        .selectDistinctOn([nutritionTargetHistory.userId], columns)
        .from(nutritionTargetHistory)
        .where(
          and(
            inArray(nutritionTargetHistory.userId, userIds),
            lt(nutritionTargetHistory.effectiveAt, since),
          ),
        )
        .orderBy(
          nutritionTargetHistory.userId,
          desc(nutritionTargetHistory.effectiveAt),
          desc(nutritionTargetHistory.createdAt),
        ),
      db
        .select(columns)
        .from(nutritionTargetHistory)
        .where(
          and(
            inArray(nutritionTargetHistory.userId, userIds),
            gte(nutritionTargetHistory.effectiveAt, since),
          ),
        )
        .orderBy(
          asc(nutritionTargetHistory.effectiveAt),
          asc(nutritionTargetHistory.createdAt),
        ),
    ]);
    for (const r of [...before, ...after]) {
      const list = out.get(r.userId) ?? [];
      list.push({
        userId: r.userId,
        dailyKcal: Number(r.dailyKcal),
        proteinG: Number(r.proteinG),
        carbsG: Number(r.carbsG),
        fatG: Number(r.fatG),
        setByUserId: r.setByUserId,
        effectiveAt: r.effectiveAt,
      });
      out.set(r.userId, list);
    }
    return out;
  }

  private async timeZones(userIds: string[]): Promise<Map<string, string>> {
    const rows = await getDb()
      .select({ id: profiles.id, tz: profiles.timezone })
      .from(profiles)
      .where(inArray(profiles.id, userIds));
    const out = new Map<string, string>();
    for (const id of userIds) out.set(id, safeTimeZone(null));
    for (const r of rows) out.set(r.id, safeTimeZone(r.tz));
    return out;
  }

  private async completedSessions(
    userIds: string[],
    since: Date,
  ): Promise<Map<string, { completedAt: Date }[]>> {
    const out = new Map<string, { completedAt: Date }[]>();
    if (userIds.length === 0) return out;
    const rows = await getDb()
      .select({
        userId: workoutSessions.userId,
        completedAt: workoutSessions.completedAt,
      })
      .from(workoutSessions)
      .where(
        and(
          inArray(workoutSessions.userId, userIds),
          eq(workoutSessions.status, "completed"),
          gte(workoutSessions.completedAt, since),
        ),
      );
    for (const r of rows) {
      const list = out.get(r.userId) ?? [];
      list.push({ completedAt: r.completedAt! });
      out.set(r.userId, list);
    }
    return out;
  }

  private async entries(
    userIds: string[],
    since: Date,
  ): Promise<{ userId: string; loggedAt: Date; kcal: number }[]> {
    if (userIds.length === 0) return [];
    const rows = await getDb()
      .select({
        userId: nutritionEntries.userId,
        loggedAt: nutritionEntries.loggedAt,
        kcal: nutritionEntries.kcal,
      })
      .from(nutritionEntries)
      .where(
        and(
          inArray(nutritionEntries.userId, userIds),
          gte(nutritionEntries.loggedAt, since),
        ),
      );
    return rows.map((r) => ({
      userId: r.userId,
      loggedAt: r.loggedAt,
      kcal: Number(r.kcal),
    }));
  }
}
