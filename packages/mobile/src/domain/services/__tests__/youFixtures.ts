import type { MuscleGroup } from "@/domain/models/exercise";
import type { PersonalRecord } from "@/domain/models/record";
import type { WorkoutSession } from "@/domain/models/session";

/** Exercise id → muscles, the shape the cached exercise library resolves to. */
export const MUSCLES: Record<
  string,
  { primary: MuscleGroup[]; secondary: MuscleGroup[] }
> = {
  bench: { primary: ["chest"], secondary: ["triceps", "shoulders"] },
  squat: { primary: ["quadriceps", "glutes"], secondary: ["hamstrings"] },
  row: { primary: ["back", "lats"], secondary: ["biceps"] },
  curl: { primary: ["biceps"], secondary: ["forearms"] },
  plank: { primary: ["core"], secondary: [] },
};

export const musclesOf = (id: string) => MUSCLES[id] ?? null;

type SetSpec = [weightKg: number | null, reps: number | null, done?: boolean];

/** A finished workout: `exercises` maps exercise id → its sets. */
export function session(
  id: string,
  startedAt: string,
  exercises: Record<string, SetSpec[]>,
  extra: Partial<WorkoutSession> = {},
): WorkoutSession {
  const start = new Date(startedAt);
  return {
    id,
    userId: "u1",
    workoutId: null,
    name: extra.name ?? `Workout ${id}`,
    status: "completed",
    startedAt,
    completedAt: new Date(start.getTime() + 60 * 60 * 1000).toISOString(),
    notes: null,
    exercises: Object.entries(exercises).map(([exerciseId, sets], i) => ({
      id: `${id}-e${i}`,
      sessionId: id,
      exerciseId,
      exerciseName: exerciseId[0]!.toUpperCase() + exerciseId.slice(1),
      sortOrder: i,
      supersetGroup: null,
      isSubstituted: false,
      originalExerciseId: null,
      notes: null,
      sets: sets.map(([weightKg, reps, done = true], n) => ({
        id: `${id}-e${i}-s${n}`,
        sessionExerciseId: `${id}-e${i}`,
        setNumber: n + 1,
        weightKg,
        reps,
        rpe: null,
        durationSeconds: null,
        distanceMeters: null,
        isCompleted: done,
        completedAt: done ? startedAt : null,
      })),
    })),
    ...extra,
  };
}

export function record(
  exerciseId: string,
  achievedAt: string,
  extra: Partial<PersonalRecord> = {},
): PersonalRecord {
  return {
    id: `pr-${exerciseId}-${achievedAt}`,
    userId: "u1",
    exerciseId,
    exerciseName: exerciseId,
    recordType: "1rm",
    value: 100,
    achievedAt,
    sessionId: null,
    setId: null,
    ...extra,
  } as PersonalRecord;
}
