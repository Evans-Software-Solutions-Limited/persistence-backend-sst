import { removeExerciseCommand } from "../remove-exercise.command";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { WorkoutSession } from "@/domain/models/session";

const seed = (
  storage: InMemoryStorageAdapter,
  exercises: WorkoutSession["exercises"],
) => {
  storage.cacheActiveSession("user-1", {
    id: "local-1",
    userId: "user-1",
    workoutId: null,
    name: "Push Day",
    status: "in_progress",
    startedAt: "2026-05-05T10:00:00.000Z",
    completedAt: null,
    notes: null,
    exercises,
  });
};

const mkExercise = (
  id: string,
  exerciseId: string,
  overrides: Partial<WorkoutSession["exercises"][number]> = {},
): WorkoutSession["exercises"][number] => ({
  id,
  sessionId: "local-1",
  exerciseId,
  exerciseName: exerciseId,
  sortOrder: 0,
  supersetGroup: null,
  isSubstituted: false,
  originalExerciseId: null,
  notes: null,
  sets: [],
  ...overrides,
});

describe("removeExerciseCommand", () => {
  it("drops the exercise from the session", () => {
    const storage = new InMemoryStorageAdapter();
    seed(storage, [
      mkExercise("se-1", "ex-bench"),
      mkExercise("se-2", "ex-row", { sortOrder: 1 }),
    ]);
    const result = removeExerciseCommand(
      { storage, userId: "user-1" },
      { sessionExerciseId: "se-1" },
    );
    expect(result.ok).toBe(true);
    const cached = storage.getActiveSession("user-1");
    expect(cached?.exercises.map((e) => e.id)).toEqual(["se-2"]);
  });

  it("ungroups the survivor when removing leaves only one peer in a superset", () => {
    const storage = new InMemoryStorageAdapter();
    seed(storage, [
      mkExercise("se-1", "ex-bench", { supersetGroup: 1 }),
      mkExercise("se-2", "ex-row", { sortOrder: 1, supersetGroup: 1 }),
    ]);
    removeExerciseCommand(
      { storage, userId: "user-1" },
      { sessionExerciseId: "se-1" },
    );
    const cached = storage.getActiveSession("user-1");
    expect(cached?.exercises[0].supersetGroup).toBeNull();
  });

  it("keeps the supersetGroup intact when 2+ peers remain", () => {
    const storage = new InMemoryStorageAdapter();
    seed(storage, [
      mkExercise("se-1", "ex-bench", { supersetGroup: 1 }),
      mkExercise("se-2", "ex-row", { sortOrder: 1, supersetGroup: 1 }),
      mkExercise("se-3", "ex-fly", { sortOrder: 2, supersetGroup: 1 }),
    ]);
    removeExerciseCommand(
      { storage, userId: "user-1" },
      { sessionExerciseId: "se-1" },
    );
    const cached = storage.getActiveSession("user-1");
    expect(cached?.exercises.map((e) => e.supersetGroup)).toEqual([1, 1]);
  });

  it("returns SESSION_NOT_FOUND when no active session exists", () => {
    const storage = new InMemoryStorageAdapter();
    const result = removeExerciseCommand(
      { storage, userId: "user-1" },
      { sessionExerciseId: "se-1" },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("SESSION_NOT_FOUND");
  });

  it("invalidates the dashboard on success", () => {
    const storage = new InMemoryStorageAdapter();
    seed(storage, [mkExercise("se-1", "ex-bench")]);
    storage.cacheDashboard("user-1", { sections: [] } as never);
    removeExerciseCommand(
      { storage, userId: "user-1" },
      { sessionExerciseId: "se-1" },
    );
    expect(storage.getCachedDashboard("user-1")).toBeNull();
  });
});
