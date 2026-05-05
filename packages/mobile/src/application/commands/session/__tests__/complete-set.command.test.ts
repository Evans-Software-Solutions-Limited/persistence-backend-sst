import { completeSetCommand } from "../complete-set.command";
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

describe("completeSetCommand", () => {
  let storage: InMemoryStorageAdapter;
  let nextId = 0;
  const generateId = () => `id-${++nextId}`;
  const startNow = () => new Date("2026-05-05T10:00:00.000Z");
  const completeNow = () => new Date("2026-05-05T10:05:00.000Z");

  const seedWithLoggedSet = () => {
    const start = startSessionCommand(
      { storage, generateId, userId: "user-1", now: startNow },
      { workout: buildWorkout() },
    );
    if (!start.ok) throw new Error("seed start failed");
    const log = logSetCommand(
      { storage, generateId, userId: "user-1" },
      {
        sessionExerciseId: start.value.exercises[0].id,
        weightKg: 80,
        reps: 8,
      },
    );
    if (!log.ok) throw new Error("seed log failed");
    return log.value;
  };

  beforeEach(() => {
    storage = new InMemoryStorageAdapter();
    nextId = 0;
  });

  it("flips the target set to isCompleted with the supplied clock", () => {
    const session = seedWithLoggedSet();
    const targetSetId = session.exercises[0].sets[1].id;

    const result = completeSetCommand(
      { storage, userId: "user-1", now: completeNow },
      { setId: targetSetId },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const set = result.value.exercises[0].sets[1];
    expect(set.isCompleted).toBe(true);
    expect(set.completedAt).toBe("2026-05-05T10:05:00.000Z");

    // Persisted.
    expect(
      storage.getActiveSession("user-1")?.exercises[0].sets[1].isCompleted,
    ).toBe(true);
  });

  it("returns SESSION_NOT_FOUND when no active session exists", () => {
    const result = completeSetCommand(
      { storage, userId: "user-1" },
      { setId: "set-x" },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("SESSION_NOT_FOUND");
  });

  it("is idempotent — already-completed sets pass through with original timestamp", () => {
    const session = seedWithLoggedSet();
    const targetSetId = session.exercises[0].sets[1].id;
    completeSetCommand(
      { storage, userId: "user-1", now: completeNow },
      { setId: targetSetId },
    );
    const second = completeSetCommand(
      {
        storage,
        userId: "user-1",
        now: () => new Date("2026-05-05T11:00:00.000Z"),
      },
      { setId: targetSetId },
    );
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.exercises[0].sets[1].completedAt).toBe(
      "2026-05-05T10:05:00.000Z",
    );
  });

  it("invalidates the dashboard cache", () => {
    const session = seedWithLoggedSet();
    const spy = jest.spyOn(storage, "invalidateDashboard");
    completeSetCommand(
      { storage, userId: "user-1", now: completeNow },
      { setId: session.exercises[0].sets[1].id },
    );
    expect(spy).toHaveBeenCalledWith("user-1");
  });

  it("falls back to new Date() when no clock is provided", () => {
    const session = seedWithLoggedSet();
    const before = Date.now();
    const result = completeSetCommand(
      { storage, userId: "user-1" },
      { setId: session.exercises[0].sets[1].id },
    );
    const after = Date.now();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const stamped = result.value.exercises[0].sets[1].completedAt;
    expect(stamped).not.toBeNull();
    if (!stamped) return;
    const ms = Date.parse(stamped);
    expect(ms).toBeGreaterThanOrEqual(before);
    expect(ms).toBeLessThanOrEqual(after);
  });
});
