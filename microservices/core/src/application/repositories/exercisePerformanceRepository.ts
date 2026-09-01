import { and, desc, eq, gt, isNotNull, lte, sql } from "drizzle-orm";
import {
  exerciseSets,
  exercises,
  sessionExercises,
  workoutSessions,
} from "@persistence/db";
import { getDb } from "@persistence/db/client";

export type EstimatedOneRepMax = {
  estimateKg: number;
  source: { weightKg: number; reps: number; completedAt: string };
};

export function estimateOneRepMax(
  weightKg: number,
  reps: number,
): number | null {
  if (!Number.isFinite(weightKg) || weightKg <= 0) return null;
  if (!Number.isInteger(reps) || reps < 1 || reps > 10) return null;
  return reps === 1 ? weightKg : weightKg * (1 + reps / 30);
}

/** Seed-name fallbacks for assisted movements whose metadata predates tagging. */
export function isClearlyAssistedExerciseName(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  return normalized.includes("assisted") || normalized === "banded dip";
}

/** Current-user performance reads; every query scopes through session owner. */
export class ExercisePerformanceRepository {
  async getBestEstimatedOneRepMax(
    userId: string,
    exerciseId: string,
  ): Promise<EstimatedOneRepMax | null> {
    const estimateSql = sql<number>`(
      (${exerciseSets.weightKg})::numeric *
      CASE WHEN ${exerciseSets.reps} = 1 THEN 1 ELSE (1 + (${exerciseSets.reps})::numeric / 30) END
    )`;
    const recordedAt = sql<Date>`coalesce(${exerciseSets.completedAt}, ${workoutSessions.completedAt})`;

    const rows = await getDb()
      .select({
        weightKg: exerciseSets.weightKg,
        reps: exerciseSets.reps,
        completedAt: recordedAt,
        estimateKg: estimateSql,
      })
      .from(exerciseSets)
      .innerJoin(
        sessionExercises,
        eq(sessionExercises.id, exerciseSets.sessionExerciseId),
      )
      .innerJoin(
        workoutSessions,
        eq(workoutSessions.id, sessionExercises.sessionId),
      )
      .innerJoin(exercises, eq(exercises.id, sessionExercises.exerciseId))
      .where(
        and(
          eq(workoutSessions.userId, userId),
          eq(sessionExercises.exerciseId, exerciseId),
          eq(workoutSessions.status, "completed"),
          eq(exerciseSets.isCompleted, true),
          gt(exerciseSets.weightKg, "0"),
          gt(exerciseSets.reps, 0),
          lte(exerciseSets.reps, 10),
          isNotNull(recordedAt),
          // A positive recorded load makes a bodyweight movement weighted, so
          // it remains eligible; bodyweight-only sets are excluded by weight>0.
          // Assisted movements are excluded by metadata, with the name check
          // covering legacy rows lacking movement_type.
          sql`coalesce(lower(${exercises.movementType}), '') <> 'assisted'`,
          sql`lower(${exercises.name}) NOT LIKE '%assisted%'`,
          // The seed's "Banded Dip" uses the band as assistance, unlike
          // ordinary band-resistance exercises (curls, presses, rows, etc.).
          sql`lower(${exercises.name}) <> 'banded dip'`,
        ),
      )
      .orderBy(desc(estimateSql), desc(recordedAt))
      .limit(1);

    const row = rows[0];
    if (!row || row.weightKg == null || row.reps == null || !row.completedAt) {
      return null;
    }
    return {
      estimateKg: Number(row.estimateKg),
      source: {
        weightKg: Number(row.weightKg),
        reps: row.reps,
        completedAt:
          row.completedAt instanceof Date
            ? row.completedAt.toISOString()
            : String(row.completedAt),
      },
    };
  }
}
