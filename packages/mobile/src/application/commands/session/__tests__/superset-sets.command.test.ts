import {
  addSupersetSetCommand,
  removeSupersetSetCommand,
} from "../superset-sets.command";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { WorkoutSession } from "@/domain/models/session";

const mkExercise = (
  id: string,
  setNumbers: number[],
  supersetGroup: number | null = 1,
): WorkoutSession["exercises"][number] => ({
  id,
  sessionId: "local-1",
  exerciseId: id,
  exerciseName: id,
  sortOrder: 0,
  supersetGroup,
  isSubstituted: false,
  originalExerciseId: null,
  notes: null,
  sets: setNumbers.map((n) => ({
    id: `${id}-set-${n}`,
    sessionExerciseId: id,
    setNumber: n,
    weightKg: null,
    reps: null,
    rpe: null,
    durationSeconds: null,
    distanceMeters: null,
    isCompleted: false,
    completedAt: null,
  })),
});

const seed = (
  storage: InMemoryStorageAdapter,
  exercises: WorkoutSession["exercises"],
) =>
  storage.cacheActiveSession("user-1", {
    id: "local-1",
    userId: "user-1",
    workoutId: null,
    name: "Push",
    status: "in_progress",
    startedAt: "2026-05-05T10:00:00.000Z",
    completedAt: null,
    notes: null,
    exercises,
  });

describe("addSupersetSetCommand", () => {
  let storage: InMemoryStorageAdapter;
  let nextId = 0;
  const generateId = () => `gen-${++nextId}`;

  beforeEach(() => {
    storage = new InMemoryStorageAdapter();
    nextId = 0;
  });

  it("adds an empty set to every exercise in the group at the same setNumber", () => {
    seed(storage, [mkExercise("se-A", [1, 2]), mkExercise("se-B", [1, 2])]);
    addSupersetSetCommand(
      { storage, generateId, userId: "user-1" },
      { sessionExerciseIds: ["se-A", "se-B"] },
    );
    const cached = storage.getActiveSession("user-1");
    const setNumbers = cached?.exercises.map((ex) =>
      ex.sets.map((s) => s.setNumber),
    );
    expect(setNumbers).toEqual([
      [1, 2, 3],
      [1, 2, 3],
    ]);
  });

  it("uses max(setNumber across peers)+1 so re-add after partial remove doesn't collide", () => {
    seed(storage, [
      mkExercise("se-A", [1, 2, 3]),
      mkExercise("se-B", [1, 2]), // shorter
    ]);
    addSupersetSetCommand(
      { storage, generateId, userId: "user-1" },
      { sessionExerciseIds: ["se-A", "se-B"] },
    );
    const cached = storage.getActiveSession("user-1");
    const supersetA = cached?.exercises.find((e) => e.id === "se-A");
    const supersetB = cached?.exercises.find((e) => e.id === "se-B");
    expect(supersetA?.sets.at(-1)?.setNumber).toBe(4);
    expect(supersetB?.sets.at(-1)?.setNumber).toBe(4);
  });

  it("starts at setNumber=1 when both peers have zero sets", () => {
    seed(storage, [mkExercise("se-A", []), mkExercise("se-B", [])]);
    addSupersetSetCommand(
      { storage, generateId, userId: "user-1" },
      { sessionExerciseIds: ["se-A", "se-B"] },
    );
    const cached = storage.getActiveSession("user-1");
    expect(cached?.exercises[0].sets[0].setNumber).toBe(1);
    expect(cached?.exercises[1].sets[0].setNumber).toBe(1);
  });

  it("ignores ids that don't match any exercise (no-op)", () => {
    seed(storage, [mkExercise("se-A", [1])]);
    addSupersetSetCommand(
      { storage, generateId, userId: "user-1" },
      { sessionExerciseIds: ["nope"] },
    );
    expect(storage.getActiveSession("user-1")?.exercises[0].sets).toHaveLength(
      1,
    );
  });

  it("returns SESSION_NOT_FOUND when no active session exists", () => {
    const result = addSupersetSetCommand(
      { storage, generateId, userId: "user-1" },
      { sessionExerciseIds: ["x"] },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("SESSION_NOT_FOUND");
  });
});

describe("removeSupersetSetCommand", () => {
  let storage: InMemoryStorageAdapter;
  beforeEach(() => {
    storage = new InMemoryStorageAdapter();
  });

  it("drops set N from every peer and renumbers survivors 1..n", () => {
    seed(storage, [
      mkExercise("se-A", [1, 2, 3]),
      mkExercise("se-B", [1, 2, 3]),
    ]);
    removeSupersetSetCommand(
      { storage, userId: "user-1" },
      { sessionExerciseIds: ["se-A", "se-B"], setNumber: 2 },
    );
    const cached = storage.getActiveSession("user-1");
    const numbers = cached?.exercises.map((ex) =>
      ex.sets.map((s) => s.setNumber),
    );
    expect(numbers).toEqual([
      [1, 2],
      [1, 2],
    ]);
  });

  it("is a no-op when no exercises match", () => {
    seed(storage, [mkExercise("se-A", [1, 2])]);
    removeSupersetSetCommand(
      { storage, userId: "user-1" },
      { sessionExerciseIds: ["nope"], setNumber: 1 },
    );
    expect(storage.getActiveSession("user-1")?.exercises[0].sets).toHaveLength(
      2,
    );
  });

  it("returns SESSION_NOT_FOUND when no active session exists", () => {
    const result = removeSupersetSetCommand(
      { storage, userId: "user-1" },
      { sessionExerciseIds: ["x"], setNumber: 1 },
    );
    expect(result.ok).toBe(false);
  });
});
