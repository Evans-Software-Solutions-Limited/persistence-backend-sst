import { logSetCommand } from "../log-set.command";
import { startSessionCommand } from "../start-session.command";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
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
      targetSets: 1,
      targetRepsMin: 8,
      targetRepsMax: 12,
      targetDurationSeconds: null,
      restSeconds: 90,
      notes: null,
      exercise: null,
    },
  ],
  createdAt: "2026-04-28T00:00:00Z",
  updatedAt: "2026-04-28T00:00:00Z",
});

describe("logSetCommand", () => {
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

  it("appends a set with caller-supplied fields and persists to SQLite", () => {
    const session = seed();
    const targetExId = session.exercises[0].id;

    const result = logSetCommand(
      { storage, generateId, userId: "user-1" },
      {
        sessionExerciseId: targetExId,
        weightKg: 80,
        reps: 8,
        rpe: 7,
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ex = result.value.exercises[0];
    expect(ex.sets).toHaveLength(2); // 1 pre-seeded + 1 new
    expect(ex.sets[1].weightKg).toBe(80);
    expect(ex.sets[1].reps).toBe(8);
    expect(ex.sets[1].rpe).toBe(7);
    expect(ex.sets[1].isCompleted).toBe(false);

    // Persisted to storage.
    const reloaded = storage.getActiveSession("user-1");
    expect(reloaded?.exercises[0].sets).toHaveLength(2);
    expect(reloaded?.exercises[0].sets[1].weightKg).toBe(80);
  });

  it("treats a falsy-zero weight as a real value (M2 learning #8)", () => {
    const session = seed();
    const result = logSetCommand(
      { storage, generateId, userId: "user-1" },
      { sessionExerciseId: session.exercises[0].id, weightKg: 0, reps: 30 },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.exercises[0].sets[1].weightKg).toBe(0);
    expect(result.value.exercises[0].sets[1].reps).toBe(30);
  });

  it("returns SESSION_NOT_FOUND when no active session exists", () => {
    const result = logSetCommand(
      { storage, generateId, userId: "user-1" },
      { sessionExerciseId: "missing" },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("SESSION_NOT_FOUND");
  });

  it("invalidates the dashboard cache", () => {
    const session = seed();
    const spy = jest.spyOn(storage, "invalidateDashboard");
    logSetCommand(
      { storage, generateId, userId: "user-1" },
      { sessionExerciseId: session.exercises[0].id },
    );
    expect(spy).toHaveBeenCalledWith("user-1");
  });

  it("does not enqueue any sync mutation per-set", () => {
    const session = seed();
    logSetCommand(
      { storage, generateId, userId: "user-1" },
      { sessionExerciseId: session.exercises[0].id, weightKg: 100, reps: 5 },
    );
    expect(storage.getPendingMutations()).toEqual([]);
  });

  it("forwards durationSeconds + distanceMeters into the new set when provided (cardio entries)", () => {
    const session = seed();
    const result = logSetCommand(
      { storage, generateId, userId: "user-1" },
      {
        sessionExerciseId: session.exercises[0].id,
        durationSeconds: 600,
        distanceMeters: 1500,
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const newSet = result.value.exercises[0].sets.at(-1);
    expect(newSet?.durationSeconds).toBe(600);
    expect(newSet?.distanceMeters).toBe(1500);
  });

  it("is a no-op when sessionExerciseId doesn't match (returns the session unchanged)", () => {
    seed();
    const result = logSetCommand(
      { storage, generateId, userId: "user-1" },
      { sessionExerciseId: "missing-ex" },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Pre-seeded set unchanged.
    expect(result.value.exercises[0].sets).toHaveLength(1);
  });
});
