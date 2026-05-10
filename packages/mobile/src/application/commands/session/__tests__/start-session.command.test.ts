import { startSessionCommand } from "../start-session.command";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { Workout } from "@/domain/models/workout";

const buildWorkout = (overrides: Partial<Workout> = {}): Workout => ({
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
  ],
  createdAt: "2026-04-28T00:00:00Z",
  updatedAt: "2026-04-28T00:00:00Z",
  ...overrides,
});

describe("startSessionCommand", () => {
  let storage: InMemoryStorageAdapter;
  let nextId = 0;
  const generateId = () => `id-${++nextId}`;
  const now = () => new Date("2026-05-05T10:00:00.000Z");

  beforeEach(() => {
    storage = new InMemoryStorageAdapter();
    nextId = 0;
  });

  it("creates an in_progress session from a workout template + caches it", () => {
    const result = startSessionCommand(
      { storage, generateId, userId: "user-1", now },
      { workout: buildWorkout() },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.workoutId).toBe("wk-1");
    expect(result.value.status).toBe("in_progress");
    expect(result.value.exercises).toHaveLength(1);
    expect(storage.getActiveSession("user-1")?.id).toBe(result.value.id);
  });

  it("creates a Quick Start (empty) session when no workout supplied", () => {
    const result = startSessionCommand({
      storage,
      generateId,
      userId: "user-1",
      now,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.workoutId).toBeNull();
    expect(result.value.exercises).toEqual([]);
    expect(result.value.name).toBe("Quick Workout");
  });

  it("invalidates the dashboard cache (M2 learning #3)", () => {
    const spy = jest.spyOn(storage, "invalidateDashboard");
    startSessionCommand({ storage, generateId, userId: "user-1", now });
    expect(spy).toHaveBeenCalledWith("user-1");
  });

  it("idempotent guard: returns ACTIVE_SESSION_EXISTS when one is already in progress", () => {
    const first = startSessionCommand(
      { storage, generateId, userId: "user-1", now },
      { workout: buildWorkout() },
    );
    expect(first.ok).toBe(true);

    const second = startSessionCommand(
      { storage, generateId, userId: "user-1", now },
      { workout: buildWorkout({ name: "Pull Day" }) },
    );
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error.code).toBe("ACTIVE_SESSION_EXISTS");
    expect(second.error.existing.workoutId).toBe("wk-1");
  });

  it("isolates by userId: User B's start does not see User A's session", () => {
    startSessionCommand(
      { storage, generateId, userId: "user-A", now },
      { workout: buildWorkout() },
    );
    const result = startSessionCommand(
      { storage, generateId, userId: "user-B", now },
      { workout: buildWorkout() },
    );
    expect(result.ok).toBe(true);
  });

  it("does not enqueue any sync mutation (sets flush only on Finish)", () => {
    startSessionCommand(
      { storage, generateId, userId: "user-1", now },
      { workout: buildWorkout() },
    );
    expect(storage.getPendingMutations()).toEqual([]);
  });

  it("falls back to new Date() when no clock is provided", () => {
    const before = Date.now();
    const result = startSessionCommand(
      { storage, generateId, userId: "user-1" },
      { workout: buildWorkout() },
    );
    const after = Date.now();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const startedMs = Date.parse(result.value.startedAt);
    expect(startedMs).toBeGreaterThanOrEqual(before);
    expect(startedMs).toBeLessThanOrEqual(after);
  });

  it("resolves exerciseName from the cached exercise when wx.exercise is null (e.g. superset peers)", () => {
    // Surface the device-reported bug: a workout-template row with a
    // null `exercise` field used to land in the session with its UUID
    // in the name column. The command now passes a cache-backed
    // resolver to the pure service, and any cached library name takes
    // precedence over the UUID fallback.
    storage.cacheExercises([
      {
        id: "ex-bench",
        name: "Bench Press",
        description: null,
        instructions: null,
        category: "strength",
        difficulty: "intermediate",
        primaryMuscleGroups: [],
        secondaryMuscleGroups: [],
        equipment: [],
        primaryMuscleGroupLabels: [],
        secondaryMuscleGroupLabels: [],
        equipmentLabels: [],
        videoUrl: null,
        thumbnailUrl: null,
        isCustom: false,
        createdBy: null,
      },
    ]);
    const result = startSessionCommand(
      { storage, generateId, userId: "user-1", now },
      { workout: buildWorkout() },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.exercises[0].exerciseName).toBe("Bench Press");
  });

  it("falls back to the exerciseId only when wx.exercise is null AND the cache is empty", () => {
    // No `cacheExercises` call — the resolver returns null, the
    // service falls through to the UUID fallback. Preserves legacy
    // behaviour for truly-missing exercises so a session can still
    // start (Story-001 AC: never block the start flow).
    const result = startSessionCommand(
      { storage, generateId, userId: "user-1", now },
      { workout: buildWorkout() },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.exercises[0].exerciseName).toBe("ex-bench");
  });
});
