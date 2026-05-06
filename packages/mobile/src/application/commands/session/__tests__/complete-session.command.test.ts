import {
  completeSessionCommand,
  finalizeSessionCommand,
} from "../complete-session.command";
import { cancelSessionCommand } from "../cancel-session.command";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { WorkoutSession } from "@/domain/models/session";

const buildSession = (
  overrides: Partial<WorkoutSession> = {},
): WorkoutSession => ({
  id: "local-1",
  userId: "user-1",
  workoutId: "wk-1",
  name: "Push Day",
  status: "in_progress",
  startedAt: "2026-05-05T10:00:00.000Z",
  completedAt: null,
  notes: null,
  exercises: [
    {
      id: "se-1",
      sessionId: "local-1",
      exerciseId: "ex-bench",
      exerciseName: "Bench Press",
      sortOrder: 0,
      supersetGroup: null,
      isSubstituted: false,
      originalExerciseId: null,
      notes: null,
      sets: [
        {
          id: "set-1",
          sessionExerciseId: "se-1",
          setNumber: 1,
          weightKg: 80,
          reps: 8,
          rpe: 7,
          durationSeconds: null,
          distanceMeters: null,
          isCompleted: true,
          completedAt: "2026-05-05T10:05:00.000Z",
        },
      ],
    },
  ],
  ...overrides,
});

describe("completeSessionCommand", () => {
  let storage: InMemoryStorageAdapter;
  const now = () => new Date("2026-05-05T11:00:00.000Z");

  beforeEach(() => {
    storage = new InMemoryStorageAdapter();
  });

  it("marks status completed, stamps completedAt, computes duration", () => {
    storage.cacheActiveSession("user-1", buildSession());
    const result = completeSessionCommand({ storage, userId: "user-1", now });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.session.status).toBe("completed");
    expect(result.value.session.completedAt).toBe("2026-05-05T11:00:00.000Z");
    // 1 hour = 3600s.
    expect(result.value.totalDurationSeconds).toBe(3600);
  });

  it("enqueues a single recordSession intent carrying the bulk payload", () => {
    storage.cacheActiveSession("user-1", buildSession());
    completeSessionCommand({ storage, userId: "user-1", now });

    const queue = storage.getPendingMutations();
    expect(queue).toHaveLength(1);
    expect(queue[0].endpoint).toBe("/sessions/record");
    expect(queue[0].method).toBe("POST");
    expect(queue[0].entityType).toBe("session");

    const payload = JSON.parse(queue[0].payload);
    expect(payload.status).toBe("completed");
    expect(payload.totalDurationSeconds).toBe(3600);
    expect(payload.workoutId).toBe("wk-1");
    expect(payload.exercises).toHaveLength(1);
    expect(payload.exercises[0].exerciseId).toBe("ex-bench");
    expect(payload.exercises[0].sets).toHaveLength(1);
    expect(payload.exercises[0].sets[0].weightKg).toBe(80);
    expect(payload.exercises[0].sets[0].isCompleted).toBe(true);
  });

  it("invalidates the dashboard cache (M2 learning #3)", () => {
    storage.cacheActiveSession("user-1", buildSession());
    storage.cacheDashboard("user-1", { sections: [] } as never);
    completeSessionCommand({ storage, userId: "user-1", now });
    expect(storage.getCachedDashboard("user-1")).toBeNull();
  });

  it("flips the cached row off the active-session view (status no longer in_progress)", () => {
    storage.cacheActiveSession("user-1", buildSession());
    completeSessionCommand({ storage, userId: "user-1", now });
    // `getActiveSession` filters by status='in_progress'; once finalized
    // the row is no longer surfaced to the active-session screen. The
    // canonical server id arrives via the worker (commit 9); the
    // completed row itself is owned by the session-history surface
    // (M4) once flushed.
    expect(storage.getActiveSession("user-1")).toBeNull();
  });

  it("returns SESSION_NOT_FOUND when no active session exists", () => {
    const result = completeSessionCommand({ storage, userId: "user-1", now });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("SESSION_NOT_FOUND");
  });

  it("captures user-entered notes onto the result + flush payload", () => {
    storage.cacheActiveSession("user-1", buildSession());
    const result = completeSessionCommand(
      { storage, userId: "user-1", now },
      { notes: "Felt strong" },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.session.notes).toBe("Felt strong");
    const payload = JSON.parse(storage.getPendingMutations()[0].payload);
    expect(payload.userNotes).toBe("Felt strong");
  });
});

describe("cancelSessionCommand", () => {
  let storage: InMemoryStorageAdapter;
  const now = () => new Date("2026-05-05T11:00:00.000Z");

  beforeEach(() => {
    storage = new InMemoryStorageAdapter();
  });

  it("marks status cancelled, preserves logged sets, enqueues bulk POST", () => {
    storage.cacheActiveSession("user-1", buildSession());
    const result = cancelSessionCommand({ storage, userId: "user-1", now });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.session.status).toBe("cancelled");

    const queue = storage.getPendingMutations();
    const payload = JSON.parse(queue[0].payload);
    expect(payload.status).toBe("cancelled");
    expect(payload.exercises[0].sets).toHaveLength(1);
    expect(payload.exercises[0].sets[0].weightKg).toBe(80);
  });

  it("returns SESSION_NOT_FOUND when no active session exists", () => {
    const result = cancelSessionCommand({ storage, userId: "user-1", now });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("SESSION_NOT_FOUND");
  });
});

describe("finalizeSessionCommand (shared path)", () => {
  it("error path uses 'cancel' wording when status is cancelled", () => {
    const storage = new InMemoryStorageAdapter();
    const result = finalizeSessionCommand(
      { storage, userId: "user-1" },
      "cancelled",
      null,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toMatch(/cancel/);
  });
});
