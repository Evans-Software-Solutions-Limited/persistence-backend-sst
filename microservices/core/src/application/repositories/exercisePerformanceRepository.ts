import { and, eq, gt, isNotNull, sql } from "drizzle-orm";
import {
  exerciseSets,
  exercises,
  sessionExercises,
  workoutSessions,
} from "@persistence/db";
import { getDb } from "@persistence/db/client";

export type PerformanceSetSource = {
  weightKg: number;
  reps: number;
  completedAt: string;
};

export type ExercisePerformanceSummary = {
  estimatedOneRepMax: {
    estimateKg: number;
    source: PerformanceSetSource;
  } | null;
  estimatedTenRepMax: {
    estimateKg: number;
    source: PerformanceSetSource;
  } | null;
  /** Heaviest completed set of exactly ten repetitions. */
  tenRepMax: {
    weightKg: number;
    source: PerformanceSetSource;
  } | null;
  /** Greatest load × repetitions recorded in one completed set. */
  bestSetVolume: {
    volumeKg: number;
    source: PerformanceSetSource;
  };
  /** Sum of load × repetitions across qualifying completed sets. */
  lifetimeVolumeKg: number;
};

export function estimateOneRepMax(
  weightKg: number,
  reps: number,
): number | null {
  if (!Number.isFinite(weightKg) || weightKg <= 0) return null;
  if (!Number.isInteger(reps) || reps < 1 || reps > 10) return null;
  return reps === 1 ? weightKg : weightKg * (1 + reps / 30);
}

/** Inverse Epley projection at ten repetitions. */
export function estimateTenRepMax(oneRepMaxKg: number): number | null {
  if (!Number.isFinite(oneRepMaxKg) || oneRepMaxKg <= 0) return null;
  return oneRepMaxKg / (1 + 10 / 30);
}

/** Seed-name fallbacks for assisted movements whose metadata predates tagging. */
export function isClearlyAssistedExerciseName(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  return normalized.includes("assisted") || normalized === "banded dip";
}

function numberOrNull(value: unknown): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function setSource(
  weightKg: unknown,
  reps: unknown,
  completedAt: unknown,
): PerformanceSetSource | null {
  const weight = numberOrNull(weightKg);
  const repetitions = numberOrNull(reps);
  if (
    weight == null ||
    repetitions == null ||
    !Number.isInteger(repetitions) ||
    completedAt == null
  ) {
    return null;
  }
  return {
    weightKg: weight,
    reps: repetitions,
    completedAt:
      completedAt instanceof Date
        ? completedAt.toISOString()
        : String(completedAt),
  };
}

/** Current-user performance reads; every query scopes through session owner. */
export class ExercisePerformanceRepository {
  async getSummary(
    userId: string,
    exerciseId: string,
  ): Promise<ExercisePerformanceSummary | null> {
    const recordedAt = sql<Date>`coalesce(${exerciseSets.completedAt}, ${workoutSessions.completedAt})`;
    const estimate = sql<number>`(
      (${exerciseSets.weightKg})::numeric *
      CASE WHEN ${exerciseSets.reps} = 1 THEN 1 ELSE (1 + (${exerciseSets.reps})::numeric / 30) END
    )`;
    const setVolume = sql<number>`(
      (${exerciseSets.weightKg})::numeric * (${exerciseSets.reps})::numeric
    )`;
    const oneToTen = sql`${exerciseSets.reps} between 1 and 10`;
    const exactlyTen = sql`${exerciseSets.reps} = 10`;

    // One aggregate query avoids transferring unbounded workout history while
    // retaining each winning set as provenance for future stat cards.
    const rows = await getDb()
      .select({
        qualifyingSetCount: sql<number>`count(*)`,
        estimatedOneRepMaxKg: sql<
          string | null
        >`max(${estimate}) filter (where ${oneToTen})`,
        oneRepSourceWeightKg: sql<
          string | null
        >`(array_agg(${exerciseSets.weightKg} order by ${estimate} desc, ${recordedAt} desc) filter (where ${oneToTen}))[1]`,
        oneRepSourceReps: sql<
          number | null
        >`(array_agg(${exerciseSets.reps} order by ${estimate} desc, ${recordedAt} desc) filter (where ${oneToTen}))[1]`,
        oneRepSourceCompletedAt: sql<Date | null>`(array_agg(${recordedAt} order by ${estimate} desc, ${recordedAt} desc) filter (where ${oneToTen}))[1]`,
        tenRepMaxKg: sql<
          string | null
        >`max(${exerciseSets.weightKg}) filter (where ${exactlyTen})`,
        tenRepMaxCompletedAt: sql<Date | null>`(array_agg(${recordedAt} order by ${exerciseSets.weightKg} desc, ${recordedAt} desc) filter (where ${exactlyTen}))[1]`,
        bestSetVolumeKg: sql<string>`max(${setVolume})`,
        bestVolumeSourceWeightKg: sql<string>`(array_agg(${exerciseSets.weightKg} order by ${setVolume} desc, ${recordedAt} desc))[1]`,
        bestVolumeSourceReps: sql<number>`(array_agg(${exerciseSets.reps} order by ${setVolume} desc, ${recordedAt} desc))[1]`,
        bestVolumeSourceCompletedAt: sql<Date>`(array_agg(${recordedAt} order by ${setVolume} desc, ${recordedAt} desc))[1]`,
        lifetimeVolumeKg: sql<string>`sum(${setVolume})`,
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
          isNotNull(recordedAt),
          // A positive recorded load keeps weighted bodyweight work eligible;
          // bodyweight-only sets remain excluded by weight > 0.
          sql`coalesce(lower(${exercises.movementType}), '') <> 'assisted'`,
          sql`lower(${exercises.name}) NOT LIKE '%assisted%'`,
          sql`lower(${exercises.name}) <> 'banded dip'`,
        ),
      )
      .limit(1);

    const row = rows[0];
    if (!row || Number(row.qualifyingSetCount) === 0) return null;

    const oneRepSource = setSource(
      row.oneRepSourceWeightKg,
      row.oneRepSourceReps,
      row.oneRepSourceCompletedAt,
    );
    const estimatedOneRepMaxKg = numberOrNull(row.estimatedOneRepMaxKg);
    const estimatedTenRepMaxKg =
      estimatedOneRepMaxKg == null
        ? null
        : estimateTenRepMax(estimatedOneRepMaxKg);
    const tenRepSource = setSource(
      row.tenRepMaxKg,
      10,
      row.tenRepMaxCompletedAt,
    );
    const bestVolumeSource = setSource(
      row.bestVolumeSourceWeightKg,
      row.bestVolumeSourceReps,
      row.bestVolumeSourceCompletedAt,
    );
    const bestSetVolumeKg = numberOrNull(row.bestSetVolumeKg);
    const lifetimeVolumeKg = numberOrNull(row.lifetimeVolumeKg);

    // Count > 0 guarantees these aggregate values. Fail closed if a driver or
    // schema mismatch violates that invariant rather than emitting bad stats.
    if (
      !bestVolumeSource ||
      bestSetVolumeKg == null ||
      lifetimeVolumeKg == null
    ) {
      return null;
    }

    return {
      estimatedOneRepMax:
        estimatedOneRepMaxKg != null && oneRepSource
          ? { estimateKg: estimatedOneRepMaxKg, source: oneRepSource }
          : null,
      estimatedTenRepMax:
        estimatedTenRepMaxKg != null && oneRepSource
          ? { estimateKg: estimatedTenRepMaxKg, source: oneRepSource }
          : null,
      tenRepMax: tenRepSource
        ? { weightKg: tenRepSource.weightKg, source: tenRepSource }
        : null,
      bestSetVolume: {
        volumeKg: bestSetVolumeKg,
        source: bestVolumeSource,
      },
      lifetimeVolumeKg,
    };
  }
}
