import { and, eq, inArray, sql } from "drizzle-orm";
import {
  exerciseSets,
  exercises,
  muscleGroups,
  profiles,
  sessionExercises,
  volumeByMusclePerUser,
  weeklyVolumePerUser,
  workoutSessions,
} from "@persistence/db";
import { getDb } from "@persistence/db/client";
import type { WindowKind } from "../progress/window";

export interface DailyVolume {
  date: string; // YYYY-MM-DD (user-local)
  volumeKg: number;
}

export interface MuscleVolume {
  muscle: string;
  kg: number;
}

/**
 * Training-volume aggregation (06-progress-goals, Phase 06.4).
 *
 * All user-local bucketing is done in Postgres via `AT TIME ZONE <tz>` inside
 * Drizzle `sql` fragments (no raw `db.execute`). Volume-by-muscle is the one
 * place a JS reduce is used instead of SQL `unnest` — `exercises.primary_muscles`
 * is a uuid[] and the per-window row set is bounded, so reducing in JS keeps us
 * inside the query-builder convention (CLAUDE.md "no raw SQL").
 *
 * Materialised tables (weekly_volume_per_user, volume_by_muscle_per_user) back
 * the fast reads; the 03:00 cron + on-session-complete recompute keep them warm.
 */
export class VolumeRepository {
  static readonly key = "VolumeRepository";

  // ─── Live daily breakdown (Home WeeklyVolume bar chart) ──────────────────
  async dailyVolume(
    userId: string,
    tz: string,
    startISO: string,
    endISO: string,
  ): Promise<DailyVolume[]> {
    const db = getDb();
    const dayExpr = sql<string>`(${workoutSessions.completedAt} AT TIME ZONE ${tz})::date`;
    const rows = await db
      .select({
        day: dayExpr,
        volume: sql<number>`COALESCE(SUM(${exerciseSets.weightKg} * ${exerciseSets.reps}), 0)::float`,
      })
      .from(exerciseSets)
      .innerJoin(
        sessionExercises,
        eq(exerciseSets.sessionExerciseId, sessionExercises.id),
      )
      .innerJoin(
        workoutSessions,
        eq(sessionExercises.sessionId, workoutSessions.id),
      )
      .where(
        and(
          eq(workoutSessions.userId, userId),
          eq(workoutSessions.status, "completed"),
          eq(exerciseSets.isCompleted, true),
          sql`(${workoutSessions.completedAt} AT TIME ZONE ${tz})::date BETWEEN ${startISO} AND ${endISO}`,
        ),
      )
      .groupBy(dayExpr);
    return rows.map((r) => {
      // postgres-js parses a `::date` (OID 1082) result into a JS Date, so
      // `String(date).slice(0,10)` would yield "Mon Jun 08" — breaking the
      // ISO-keyed Map lookup in fillWeekDays (every bar → 0). Normalise both
      // the Date (real driver) and string (test mock) shapes (Inspector). The
      // column is sql<string>-typed, so widen via unknown to runtime-check.
      const day = r.day as unknown;
      return {
        date:
          day instanceof Date
            ? day.toISOString().slice(0, 10)
            : String(day).slice(0, 10),
        volumeKg: Number(r.volume) || 0,
      };
    });
  }

  async totalVolume(
    userId: string,
    tz: string,
    startISO: string,
    endISO: string,
  ): Promise<number> {
    const db = getDb();
    const rows = await db
      .select({
        v: sql<number>`COALESCE(SUM(${exerciseSets.weightKg} * ${exerciseSets.reps}), 0)::float`,
      })
      .from(exerciseSets)
      .innerJoin(
        sessionExercises,
        eq(exerciseSets.sessionExerciseId, sessionExercises.id),
      )
      .innerJoin(
        workoutSessions,
        eq(sessionExercises.sessionId, workoutSessions.id),
      )
      .where(
        and(
          eq(workoutSessions.userId, userId),
          eq(workoutSessions.status, "completed"),
          eq(exerciseSets.isCompleted, true),
          sql`(${workoutSessions.completedAt} AT TIME ZONE ${tz})::date BETWEEN ${startISO} AND ${endISO}`,
        ),
      );
    return Number(rows[0]?.v) || 0;
  }

  async completedSessionCount(
    userId: string,
    tz: string,
    startISO: string,
    endISO: string,
  ): Promise<number> {
    const db = getDb();
    const rows = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(workoutSessions)
      .where(
        and(
          eq(workoutSessions.userId, userId),
          eq(workoutSessions.status, "completed"),
          sql`(${workoutSessions.completedAt} AT TIME ZONE ${tz})::date BETWEEN ${startISO} AND ${endISO}`,
        ),
      );
    return Number(rows[0]?.c) || 0;
  }

  // ─── Materialise weekly volume ───────────────────────────────────────────
  async recomputeWeeklyVolume(
    userId: string,
    tz: string,
    weekStartISO: string,
    weekEndISO: string,
  ): Promise<void> {
    const db = getDb();
    const volumeKg = await this.totalVolume(
      userId,
      tz,
      weekStartISO,
      weekEndISO,
    );
    const sessionCount = await this.completedSessionCount(
      userId,
      tz,
      weekStartISO,
      weekEndISO,
    );
    await db
      .insert(weeklyVolumePerUser)
      .values({
        userId,
        weekStart: weekStartISO,
        volumeKg: String(volumeKg),
        sessionCount,
      })
      .onConflictDoUpdate({
        target: [weeklyVolumePerUser.userId, weeklyVolumePerUser.weekStart],
        set: {
          volumeKg: String(volumeKg),
          sessionCount,
          computedAt: new Date(),
        },
      });
  }

  async getWeeklyRow(
    userId: string,
    weekStartISO: string,
  ): Promise<{ volumeKg: number; sessionCount: number } | null> {
    const db = getDb();
    const rows = await db
      .select({
        volumeKg: weeklyVolumePerUser.volumeKg,
        sessionCount: weeklyVolumePerUser.sessionCount,
      })
      .from(weeklyVolumePerUser)
      .where(
        and(
          eq(weeklyVolumePerUser.userId, userId),
          eq(weeklyVolumePerUser.weekStart, weekStartISO),
        ),
      )
      .limit(1);
    const row = rows[0];
    return row
      ? { volumeKg: Number(row.volumeKg) || 0, sessionCount: row.sessionCount }
      : null;
  }

  // ─── Materialise volume-by-muscle ────────────────────────────────────────
  async recomputeVolumeByMuscle(
    userId: string,
    tz: string,
    windowKind: WindowKind,
    windowStartISO: string,
  ): Promise<void> {
    const db = getDb();

    const rows = await db
      .select({
        weightKg: exerciseSets.weightKg,
        reps: exerciseSets.reps,
        primaryMuscles: exercises.primaryMuscles,
      })
      .from(exerciseSets)
      .innerJoin(
        sessionExercises,
        eq(exerciseSets.sessionExerciseId, sessionExercises.id),
      )
      .innerJoin(
        workoutSessions,
        eq(sessionExercises.sessionId, workoutSessions.id),
      )
      .innerJoin(exercises, eq(sessionExercises.exerciseId, exercises.id))
      .where(
        and(
          eq(workoutSessions.userId, userId),
          eq(workoutSessions.status, "completed"),
          eq(exerciseSets.isCompleted, true),
          sql`(${workoutSessions.completedAt} AT TIME ZONE ${tz})::date >= ${windowStartISO}`,
        ),
      );

    // Each set's volume contributes to every primary muscle of its exercise.
    const byMuscleId = new Map<string, number>();
    for (const r of rows) {
      const vol = (Number(r.weightKg) || 0) * (Number(r.reps) || 0);
      if (vol <= 0) continue;
      for (const muscleId of r.primaryMuscles ?? []) {
        byMuscleId.set(muscleId, (byMuscleId.get(muscleId) ?? 0) + vol);
      }
    }

    const muscleIds = [...byMuscleId.keys()];
    const nameById = await this.resolveMuscleNames(muscleIds);

    // Sum by canonical muscle name (multiple ids could map to same name).
    const byName = new Map<string, number>();
    for (const [id, vol] of byMuscleId) {
      const name = nameById.get(id);
      if (!name) continue;
      byName.set(name, (byName.get(name) ?? 0) + vol);
    }

    // Replace the window's rows atomically so stale muscles don't linger.
    await db.transaction(async (tx) => {
      await tx
        .delete(volumeByMusclePerUser)
        .where(
          and(
            eq(volumeByMusclePerUser.userId, userId),
            eq(volumeByMusclePerUser.windowKind, windowKind),
            eq(volumeByMusclePerUser.windowStart, windowStartISO),
          ),
        );
      if (byName.size > 0) {
        await tx.insert(volumeByMusclePerUser).values(
          [...byName.entries()].map(([muscle, kg]) => ({
            userId,
            windowStart: windowStartISO,
            windowKind,
            muscleGroup: muscle,
            volumeKg: String(kg),
          })),
        );
      }
    });
  }

  private async resolveMuscleNames(
    muscleIds: string[],
  ): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    if (muscleIds.length === 0) return map;
    const db = getDb();
    const rows = await db
      .select({
        id: muscleGroups.id,
        name: muscleGroups.name,
        displayName: muscleGroups.displayName,
      })
      .from(muscleGroups)
      .where(inArray(muscleGroups.id, muscleIds));
    for (const r of rows) {
      map.set(r.id, r.displayName ?? r.name);
    }
    return map;
  }

  async getVolumeByMuscle(
    userId: string,
    windowKind: WindowKind,
    windowStartISO: string,
  ): Promise<MuscleVolume[]> {
    const db = getDb();
    const rows = await db
      .select({
        muscle: volumeByMusclePerUser.muscleGroup,
        kg: volumeByMusclePerUser.volumeKg,
      })
      .from(volumeByMusclePerUser)
      .where(
        and(
          eq(volumeByMusclePerUser.userId, userId),
          eq(volumeByMusclePerUser.windowKind, windowKind),
          eq(volumeByMusclePerUser.windowStart, windowStartISO),
        ),
      );
    return rows
      .map((r) => ({ muscle: r.muscle, kg: Number(r.kg) || 0 }))
      .sort((a, b) => b.kg - a.kg);
  }

  async getUserTimezone(userId: string): Promise<string> {
    const db = getDb();
    const rows = await db
      .select({ tz: profiles.timezone })
      .from(profiles)
      .where(eq(profiles.id, userId))
      .limit(1);
    return rows[0]?.tz ?? "Europe/London";
  }

  /** Distinct user_ids with at least one completed session — drives the cron. */
  async userIdsWithCompletedSessions(): Promise<string[]> {
    const db = getDb();
    const rows = await db
      .selectDistinct({ userId: workoutSessions.userId })
      .from(workoutSessions)
      .where(eq(workoutSessions.status, "completed"));
    return rows.map((r) => r.userId);
  }
}
