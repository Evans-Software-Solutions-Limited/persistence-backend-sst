/**
 * Window maths over finished workouts, in the shape the server reads them.
 * Counts exactly as the phone's You page does (`domain/services/youPage.ts`
 * and `workoutSummary.ts` in packages/mobile); the shared fixtures in
 * `fixtures.ts` hold the two sides to the same numbers.
 */
import { estimateOneRepMax } from "./oneRepMax";
import { muscleCredit, type MuscleCreditInput } from "./muscleCredit";

export type TrainingSet = {
  id: string;
  isCompleted: boolean;
  reps: number | null;
  weightKg: number | null;
};

export type TrainingExercise = {
  exerciseId: string;
  name: string;
  /** Swapped out mid-workout: its sets never count. */
  isSubstituted: boolean;
  /** Skipped on the phone (not stored on the server). No muscle credit. */
  skipped?: boolean;
  /** App muscle keys (`quadriceps`, `core`, …). */
  primary: readonly string[];
  secondary: readonly string[];
  sets: readonly TrainingSet[];
};

export type TrainingSession = {
  id: string;
  name: string;
  startedAt: string;
  completedAt: string | null;
  /** Stored length (a back-dated workout's), else finish − start. */
  durationSeconds: number | null;
  exercises: readonly TrainingExercise[];
};

export type SessionTotals = {
  durationSeconds: number;
  volumeKg: number;
  sets: number;
};

export type TrainingTotals = SessionTotals & { workouts: number };

const counted = (e: TrainingExercise) => !e.isSubstituted;

/** One workout's length, volume and completed sets. */
export function sessionTotals(s: TrainingSession): SessionTotals {
  let volumeKg = 0;
  let sets = 0;
  for (const e of s.exercises.filter(counted))
    for (const set of e.sets) {
      if (!set.isCompleted) continue;
      sets += 1;
      if (set.weightKg != null && set.reps != null)
        volumeKg += set.weightKg * set.reps;
    }
  const start = Date.parse(s.startedAt);
  const end = s.completedAt ? Date.parse(s.completedAt) : Number.NaN;
  const durationSeconds =
    s.durationSeconds ??
    (Number.isFinite(start) && Number.isFinite(end)
      ? Math.max(0, Math.floor((end - start) / 1000))
      : 0);
  return { durationSeconds, volumeKg, sets };
}

/** Workouts · Volume · Time · Sets across a window. */
export function windowTotals(
  sessions: readonly TrainingSession[],
): TrainingTotals {
  return sessions.reduce<TrainingTotals>(
    (acc, s) => {
      const t = sessionTotals(s);
      return {
        workouts: acc.workouts + 1,
        durationSeconds: acc.durationSeconds + t.durationSeconds,
        volumeKg: acc.volumeKg + t.volumeKg,
        sets: acc.sets + t.sets,
      };
    },
    { workouts: 0, durationSeconds: 0, volumeKg: 0, sets: 0 },
  );
}

/** Completed sets that earn muscle credit: reps > 0. */
export function creditedSets(e: TrainingExercise): number {
  return e.sets.filter((s) => s.isCompleted && (s.reps ?? 0) > 0).length;
}

/** Muscle-credit inputs for a window (substituted and skipped left out). */
export function muscleInputs(
  sessions: readonly TrainingSession[],
): MuscleCreditInput[] {
  return sessions.flatMap((s) =>
    s.exercises
      .filter((e) => counted(e) && !e.skipped)
      .map((e) => ({
        primary: e.primary,
        secondary: e.secondary,
        completedSets: creditedSets(e),
      })),
  );
}

/** `muscleCredit` across every workout in the window. */
export function windowMuscles(sessions: readonly TrainingSession[]) {
  return muscleCredit(muscleInputs(sessions));
}

export type TopLift = {
  exerciseId: string;
  name: string;
  weightKg: number;
  reps: number;
  /** When the workout with the best set started. */
  startedAt: string;
  oneRepMaxKg: number;
  /** A personal record for this exercise fell inside the window. */
  isRecord: boolean;
};

const byStart = (a: TrainingSession, b: TrainingSession) =>
  Date.parse(a.startedAt) - Date.parse(b.startedAt);

/**
 * Top lifts by estimated 1RM: each exercise's best completed set, best
 * first. The first set to reach a lift's best keeps it.
 */
export function topLifts(
  sessions: readonly TrainingSession[],
  recordExerciseIds: ReadonlySet<string>,
  limit = 5,
): TopLift[] {
  const best = new Map<string, TopLift>();
  for (const s of [...sessions].sort(byStart))
    for (const e of s.exercises) {
      if (e.isSubstituted || e.skipped) continue;
      for (const set of e.sets) {
        if (!set.isCompleted || set.weightKg == null || set.reps == null)
          continue;
        const orm = estimateOneRepMax(set.weightKg, set.reps);
        if (orm == null) continue;
        const prev = best.get(e.exerciseId);
        if (prev && prev.oneRepMaxKg >= orm) continue;
        best.set(e.exerciseId, {
          exerciseId: e.exerciseId,
          name: e.name,
          weightKg: set.weightKg,
          reps: set.reps,
          startedAt: s.startedAt,
          oneRepMaxKg: orm,
          isRecord: false,
        });
      }
    }
  return [...best.values()]
    .map((l) => ({ ...l, isRecord: recordExerciseIds.has(l.exerciseId) }))
    .sort((a, b) => b.oneRepMaxKg - a.oneRepMaxKg)
    .slice(0, limit);
}

/** Weighted exercises by volume across a window, largest first (Recap). */
export function exerciseVolumes(
  sessions: readonly TrainingSession[],
): { exerciseId: string; name: string; volumeKg: number }[] {
  const volume = new Map<string, { name: string; volumeKg: number }>();
  for (const s of [...sessions].sort(byStart))
    for (const e of s.exercises.filter(counted)) {
      let v = 0;
      for (const set of e.sets)
        if (set.isCompleted && set.weightKg != null && set.reps != null)
          v += set.weightKg * set.reps;
      if (v <= 0) continue;
      const row = volume.get(e.exerciseId) ?? { name: e.name, volumeKg: 0 };
      row.volumeKg += v;
      volume.set(e.exerciseId, row);
    }
  return [...volume.entries()]
    .map(([exerciseId, v]) => ({ exerciseId, ...v }))
    .sort((a, b) => b.volumeKg - a.volumeKg);
}
