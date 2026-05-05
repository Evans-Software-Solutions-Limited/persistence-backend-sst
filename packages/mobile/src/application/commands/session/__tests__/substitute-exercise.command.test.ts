import { startSessionCommand } from "../start-session.command";
import { substituteExerciseCommand } from "../substitute-exercise.command";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { Exercise } from "@/domain/models/exercise";
import type { Workout } from "@/domain/models/workout";

const buildWorkout = (): Workout => ({
  id: "wk-1",
  name: "Push Day",
  description: null,
  createdBy: "user-1",
  visibility: "private",
  estimatedDurationMinutes: 45,
  exercises: [
    {
      id: "we-1",
      exerciseId: "ex-bench",
      sortOrder: 0,
      supersetGroup: null,
      targetSets: 3,
      targetRepsMin: 8,
      targetRepsMax: 12,
      targetDurationSeconds: null,
      restSeconds: 90,
      notes: null,
      exercise: null,
    },
    {
      id: "we-2",
      exerciseId: "ex-row",
      sortOrder: 1,
      supersetGroup: null,
      targetSets: 2,
      targetRepsMin: 8,
      targetRepsMax: 12,
      targetDurationSeconds: null,
      restSeconds: 60,
      notes: null,
      exercise: null,
    },
  ],
  createdAt: "2026-04-28T00:00:00Z",
  updatedAt: "2026-04-28T00:00:00Z",
});

const buildExercise = (overrides: Partial<Exercise> = {}): Exercise => ({
  id: "ex-incline",
  name: "Incline Bench Press",
  description: null,
  instructions: null,
  category: "strength",
  difficulty: "intermediate",
  primaryMuscleGroups: [],
  secondaryMuscleGroups: [],
  equipment: [],
  videoUrl: null,
  thumbnailUrl: null,
  isCustom: false,
  createdBy: null,
  ...overrides,
});

describe("substituteExerciseCommand", () => {
  let storage: InMemoryStorageAdapter;
  let nextId = 0;
  const generateId = () => `id-${++nextId}`;
  const now = () => new Date("2026-05-05T10:00:00.000Z");

  const seed = () => {
    const start = startSessionCommand(
      { storage, generateId, userId: "user-1", now },
      { workout: buildWorkout() },
    );
    if (!start.ok) throw new Error("seed failed");
    return start.value;
  };

  beforeEach(() => {
    storage = new InMemoryStorageAdapter();
    nextId = 0;
  });

  it("marks the old row substituted, inserts new at oldSortOrder+1, shifts downstream", () => {
    const session = seed();
    const oldId = session.exercises[0].id;

    const result = substituteExerciseCommand(
      { storage, generateId, userId: "user-1" },
      { oldSessionExerciseId: oldId, newExercise: buildExercise() },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.exercises).toHaveLength(3);
    expect(result.value.exercises[0].id).toBe(oldId);
    expect(result.value.exercises[0].isSubstituted).toBe(true);
    expect(result.value.exercises[0].sets).toHaveLength(3); // sets preserved
    expect(result.value.exercises[1].exerciseName).toBe("Incline Bench Press");
    expect(result.value.exercises[1].originalExerciseId).toBe("ex-bench");
    expect(result.value.exercises[2].sortOrder).toBe(2);

    // Persisted to storage.
    const reloaded = storage.getActiveSession("user-1");
    expect(reloaded?.exercises).toHaveLength(3);
  });

  it("returns SESSION_NOT_FOUND when no session exists", () => {
    const result = substituteExerciseCommand(
      { storage, generateId, userId: "user-1" },
      { oldSessionExerciseId: "x", newExercise: buildExercise() },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("SESSION_NOT_FOUND");
  });

  it("invalidates the dashboard cache", () => {
    const session = seed();
    const spy = jest.spyOn(storage, "invalidateDashboard");
    substituteExerciseCommand(
      { storage, generateId, userId: "user-1" },
      {
        oldSessionExerciseId: session.exercises[0].id,
        newExercise: buildExercise(),
      },
    );
    expect(spy).toHaveBeenCalledWith("user-1");
  });

  it("does not enqueue any sync mutation (sets flush only on Finish)", () => {
    const session = seed();
    substituteExerciseCommand(
      { storage, generateId, userId: "user-1" },
      {
        oldSessionExerciseId: session.exercises[0].id,
        newExercise: buildExercise(),
      },
    );
    expect(storage.getPendingMutations()).toEqual([]);
  });

  it("is a no-op when oldSessionExerciseId doesn't match", () => {
    seed();
    const result = substituteExerciseCommand(
      { storage, generateId, userId: "user-1" },
      { oldSessionExerciseId: "missing", newExercise: buildExercise() },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.exercises).toHaveLength(2);
  });
});
