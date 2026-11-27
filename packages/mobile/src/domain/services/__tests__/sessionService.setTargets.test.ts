import { createSessionFromWorkout } from "../sessionService";
import type { Workout, WorkoutExercise } from "@/domain/models/workout";

/** PER-139: the active workout pre-fills each set's target reps. */

const exercise = (
  overrides: Partial<WorkoutExercise> = {},
): WorkoutExercise => ({
  id: "we-1",
  exerciseId: "ex-bench",
  sortOrder: 0,
  supersetGroup: null,
  targetSets: 3,
  targetRepsMin: 8,
  targetRepsMax: 10,
  targetDurationSeconds: null,
  restSeconds: 90,
  notes: null,
  exercise: {
    id: "ex-bench",
    name: "Bench Press",
    category: "strength",
    difficultyLevel: "intermediate",
    videoUrl: null,
    thumbnailUrl: null,
  },
  ...overrides,
});

const workout = (exercises: WorkoutExercise[]): Workout => ({
  id: "wk-1",
  name: "Push",
  description: null,
  createdBy: "user-1",
  visibility: "private",
  estimatedDurationMinutes: 45,
  showInOwnerLibrary: true,
  createdAt: "2026-11-26T10:00:00.000Z",
  updatedAt: "2026-11-26T10:00:00.000Z",
  exercises,
});

const ids = () => {
  let i = 0;
  return () => `id-${++i}`;
};
const ctx = { userId: "user-1", now: "2026-11-26T10:00:00.000Z" };

describe("createSessionFromWorkout — reps per set (PER-139)", () => {
  it("pre-fills set n with its target reps (10 / 8 / 8), weight left empty", () => {
    const session = createSessionFromWorkout(
      workout([
        exercise({ setTargets: [{ reps: 10 }, { reps: 8 }, { reps: 8 }] }),
      ]),
      ctx,
      ids(),
    );
    const sets = session.exercises[0]!.sets;
    expect(sets.map((s) => s.reps)).toEqual([10, 8, 8]);
    expect(sets.map((s) => s.setNumber)).toEqual([1, 2, 3]);
    expect(sets.every((s) => s.weightKg === null && !s.isCompleted)).toBe(true);
  });

  it("uses the per-set count when it differs from a stale targetSets", () => {
    const session = createSessionFromWorkout(
      workout([
        exercise({
          targetSets: 2,
          setTargets: [{ reps: 6 }, { reps: 6 }, { reps: 5 }],
        }),
      ]),
      ctx,
      ids(),
    );
    expect(session.exercises[0]!.sets.map((s) => s.reps)).toEqual([6, 6, 5]);
  });

  it("an existing workout (no per-set targets) starts with empty sets, as before", () => {
    const session = createSessionFromWorkout(workout([exercise()]), ctx, ids());
    const sets = session.exercises[0]!.sets;
    expect(sets).toHaveLength(3);
    expect(sets.every((s) => s.reps === null)).toBe(true);
  });

  it("plyometric and cardio keep empty sets (reps alone would count as logged)", () => {
    const plyo = exercise({
      setTargets: [{ reps: 5 }, { reps: 5 }],
      exercise: {
        id: "ex-jump",
        name: "Box jump",
        category: "plyometric",
        difficultyLevel: "beginner",
        videoUrl: null,
        thumbnailUrl: null,
      },
    });
    const cardio = exercise({
      id: "we-2",
      setTargets: [{ reps: 1 }],
      targetSets: 1,
      exercise: {
        id: "ex-run",
        name: "Run",
        category: "cardio",
        difficultyLevel: "beginner",
        videoUrl: null,
        thumbnailUrl: null,
      },
    });
    const session = createSessionFromWorkout(
      workout([plyo, { ...cardio, sortOrder: 1 }]),
      ctx,
      ids(),
    );
    expect(session.exercises[0]!.sets.every((s) => s.reps === null)).toBe(true);
    expect(session.exercises[0]!.category).toBe("plyometric");
    expect(session.exercises[1]!.sets).toHaveLength(1);
    expect(session.exercises[1]!.sets[0]!.reps).toBeNull();
  });
});
