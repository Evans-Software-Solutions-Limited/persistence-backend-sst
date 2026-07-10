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

  it("synthesizes isCompleted on logged sets so summary stats are non-zero post-1A.1", () => {
    // Post-1A.1 the Mark-Complete UI is gone — sets enter finalize with
    // isCompleted=false. calculateSummary, detectPersonalRecords, and
    // the bulk-record payload all gate on isCompleted, so without
    // synthesis at finalize time, every Summary screen reads zero.
    const session = buildSession();
    session.exercises[0].sets = [
      {
        id: "set-1",
        sessionExerciseId: "se-1",
        setNumber: 1,
        weightKg: 80,
        reps: 8,
        rpe: null,
        durationSeconds: null,
        distanceMeters: null,
        isCompleted: false,
        completedAt: null,
      },
      {
        id: "set-2",
        sessionExerciseId: "se-1",
        setNumber: 2,
        weightKg: null,
        reps: null,
        rpe: null,
        durationSeconds: null,
        distanceMeters: null,
        isCompleted: false,
        completedAt: null,
      },
    ];
    storage.cacheActiveSession("user-1", session);

    completeSessionCommand({ storage, userId: "user-1", now });

    // Cached session reflects the synthesis: set 1 completed, set 2
    // (no data) untouched.
    const cached = storage.getLatestSession("user-1");
    expect(cached?.exercises[0].sets[0].isCompleted).toBe(true);
    expect(cached?.exercises[0].sets[0].completedAt).toBe(
      "2026-05-05T11:00:00.000Z",
    );
    expect(cached?.exercises[0].sets[1].isCompleted).toBe(false);

    // Bulk-record payload also reflects the synthesis.
    const payload = JSON.parse(storage.getPendingMutations()[0].payload);
    expect(payload.exercises[0].sets[0].isCompleted).toBe(true);
    expect(payload.exercises[0].sets[1].isCompleted).toBe(false);
  });

  it("does NOT synthesize isCompleted on cancelled sessions", () => {
    const session = buildSession();
    session.exercises[0].sets[0].isCompleted = false;
    session.exercises[0].sets[0].completedAt = null;
    storage.cacheActiveSession("user-1", session);

    cancelSessionCommand({ storage, userId: "user-1", now });

    const cached = storage.getLatestSession("user-1");
    expect(cached?.exercises[0].sets[0].isCompleted).toBe(false);
  });

  it("preserves an existing completedAt when synthesizing (already-completed sets are untouched)", () => {
    const session = buildSession();
    // Set 1 is already completed at an earlier timestamp — synthesis
    // must not overwrite it.
    session.exercises[0].sets[0].isCompleted = true;
    session.exercises[0].sets[0].completedAt = "2026-05-05T10:30:00.000Z";
    storage.cacheActiveSession("user-1", session);

    completeSessionCommand({ storage, userId: "user-1", now });

    const cached = storage.getLatestSession("user-1");
    expect(cached?.exercises[0].sets[0].completedAt).toBe(
      "2026-05-05T10:30:00.000Z",
    );
  });

  it("upserts logged sets into the recent-sets cache so next session's Previous chip surfaces", () => {
    storage.cacheActiveSession("user-1", buildSession());
    completeSessionCommand({ storage, userId: "user-1", now });
    const recent = storage.getRecentSetsByExercise("user-1", ["ex-bench"]);
    expect(recent["ex-bench"]?.[1]).toEqual({ weightKg: 80, reps: 8 });
  });

  it("skips recent-sets upsert when a set is missing weight or reps", () => {
    const session = buildSession();
    session.exercises[0].sets.push({
      id: "set-2",
      sessionExerciseId: "se-1",
      setNumber: 2,
      weightKg: null,
      reps: null,
      rpe: null,
      durationSeconds: null,
      distanceMeters: null,
      isCompleted: false,
      completedAt: null,
    });
    storage.cacheActiveSession("user-1", session);
    completeSessionCommand({ storage, userId: "user-1", now });
    const recent = storage.getRecentSetsByExercise("user-1", ["ex-bench"]);
    expect(recent["ex-bench"]?.[1]).toEqual({ weightKg: 80, reps: 8 });
    // Set 2 has null weight/reps — never lands in the cache.
    expect(recent["ex-bench"]?.[2]).toBeUndefined();
  });

  it("excludes substituted exercises from the recent-sets upsert", () => {
    const session = buildSession();
    session.exercises[0].isSubstituted = true;
    storage.cacheActiveSession("user-1", session);
    completeSessionCommand({ storage, userId: "user-1", now });
    const recent = storage.getRecentSetsByExercise("user-1", ["ex-bench"]);
    expect(recent["ex-bench"]).toBeUndefined();
  });

  // ── M18 coach Start-live — on-behalf endpoint routing ─────────────────────
  it("routes the flush to the self /sessions/record endpoint by default", () => {
    storage.cacheActiveSession("user-1", buildSession());
    completeSessionCommand({ storage, userId: "user-1", now });
    expect(storage.getPendingMutations()[0].endpoint).toBe("/sessions/record");
  });

  it("routes the flush to the on-behalf endpoint when onBehalfClientId is set", () => {
    storage.cacheActiveSession("user-1", buildSession());
    completeSessionCommand(
      { storage, userId: "user-1", now },
      { onBehalfClientId: "client-9" },
    );
    const queue = storage.getPendingMutations();
    expect(queue[0].endpoint).toBe(
      "/trainers/me/clients/client-9/sessions/record",
    );
    // Same payload shape — the endpoint is the only thing that changes.
    const payload = JSON.parse(queue[0].payload);
    expect(payload.status).toBe("completed");
    expect(payload.exercises).toHaveLength(1);
  });

  it("does NOT write recent-sets for a coach on-behalf session (Inspector Brad M18 — no coach-history pollution)", () => {
    storage.cacheActiveSession("user-1", buildSession());
    completeSessionCommand(
      { storage, userId: "user-1", now },
      { onBehalfClientId: "client-9" },
    );
    // deps.userId is the COACH here — the client's lifts must not land in the
    // coach's own recent-sets cache.
    const recent = storage.getRecentSetsByExercise("user-1", ["ex-bench"]);
    expect(recent["ex-bench"]).toBeUndefined();
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

  it("does NOT upsert recent-sets on cancellation (cancelled sessions aren't real workouts)", () => {
    storage.cacheActiveSession("user-1", buildSession());
    cancelSessionCommand({ storage, userId: "user-1", now });
    const recent = storage.getRecentSetsByExercise("user-1", ["ex-bench"]);
    expect(recent["ex-bench"]).toBeUndefined();
  });

  it("returns SESSION_NOT_FOUND when no active session exists", () => {
    const result = cancelSessionCommand({ storage, userId: "user-1", now });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("SESSION_NOT_FOUND");
  });

  it("routes a discarded coach session to the on-behalf endpoint (cancelled)", () => {
    storage.cacheActiveSession("user-1", buildSession());
    cancelSessionCommand(
      { storage, userId: "user-1", now },
      { onBehalfClientId: "client-9" },
    );
    const queue = storage.getPendingMutations();
    expect(queue[0].endpoint).toBe(
      "/trainers/me/clients/client-9/sessions/record",
    );
    expect(JSON.parse(queue[0].payload).status).toBe("cancelled");
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
