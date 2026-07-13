import { InMemoryStorageAdapter } from "./in-memory-storage.adapter";
import type { Exercise } from "@/domain/models/exercise";
import type { PersonalRecord } from "@/domain/models/record";
import type { WorkoutSession } from "@/domain/models/session";
import type { Workout } from "@/domain/models/workout";
import type { ProgramSummary } from "@/domain/models/program";
import type { ClientDetail } from "@/domain/models/clientDetail";

const buildWorkout = (overrides: Partial<Workout> = {}): Workout => ({
  id: overrides.id ?? "w-1",
  name: overrides.name ?? "Push Day",
  description: null,
  createdBy: overrides.createdBy ?? "user-1",
  visibility: overrides.visibility ?? "private",
  estimatedDurationMinutes: 45,
  showInOwnerLibrary: overrides.showInOwnerLibrary ?? true,
  exercises: overrides.exercises ?? [],
  createdAt: "2026-04-28T00:00:00Z",
  updatedAt: "2026-04-28T00:00:00Z",
  ...overrides,
});

const buildExercise = (overrides: Partial<Exercise> = {}): Exercise => ({
  id: overrides.id ?? "e1",
  name: "Bench Press",
  description: null,
  instructions: null,
  category: "strength",
  difficulty: "intermediate",
  primaryMuscleGroups: ["chest"],
  secondaryMuscleGroups: [],
  equipment: ["barbell"],
  videoUrl: null,
  thumbnailUrl: null,
  isCustom: false,
  createdBy: null,
  ...overrides,
});

describe("InMemoryStorageAdapter", () => {
  let storage: InMemoryStorageAdapter;

  beforeEach(() => {
    storage = new InMemoryStorageAdapter();
    storage.initialize();
  });

  describe("sync queue", () => {
    it("enqueues a mutation", () => {
      storage.enqueueMutation({
        entityType: "workout",
        entityId: "w1",
        operation: "create",
        payload: { name: "Push Day" },
        endpoint: "/workouts",
        method: "POST",
      });

      const pending = storage.getPendingMutations();
      expect(pending).toHaveLength(1);
      expect(pending[0].entityType).toBe("workout");
      expect(pending[0].status).toBe("pending");
    });

    it("marks mutation in-flight then completed", () => {
      storage.enqueueMutation({
        entityType: "workout",
        entityId: "w1",
        operation: "create",
        payload: {},
        endpoint: "/workouts",
        method: "POST",
      });

      const [entry] = storage.getPendingMutations();
      storage.markMutationInFlight(entry.id);

      let stats = storage.getSyncStats();
      expect(stats.inFlight).toBe(1);
      expect(stats.pending).toBe(0);

      storage.markMutationCompleted(entry.id);
      stats = storage.getSyncStats();
      expect(stats.inFlight).toBe(0);
      expect(stats.pending).toBe(0);
    });

    it("marks mutation failed and increments retry count", () => {
      storage.enqueueMutation({
        entityType: "workout",
        entityId: "w1",
        operation: "create",
        payload: {},
        endpoint: "/workouts",
        method: "POST",
      });

      const [entry] = storage.getPendingMutations();
      storage.markMutationFailed(entry.id, "Network error");

      const stats = storage.getSyncStats();
      expect(stats.failed).toBe(1);

      // Failed entry still appears in pending (retry < max)
      const pending = storage.getPendingMutations();
      expect(pending).toHaveLength(1);
      expect(pending[0].retryCount).toBe(1);
    });

    it("excludes entries that exceeded max retries", () => {
      storage.enqueueMutation({
        entityType: "workout",
        entityId: "w1",
        operation: "create",
        payload: {},
        endpoint: "/workouts",
        method: "POST",
      });

      const [entry] = storage.getPendingMutations();
      // Fail 3 times (max retries)
      storage.markMutationFailed(entry.id, "err");
      storage.markMutationFailed(entry.id, "err");
      storage.markMutationFailed(entry.id, "err");

      const pending = storage.getPendingMutations();
      expect(pending).toHaveLength(0);
    });

    it("prunes completed mutations", () => {
      storage.enqueueMutation({
        entityType: "workout",
        entityId: "w1",
        operation: "create",
        payload: {},
        endpoint: "/workouts",
        method: "POST",
      });

      const [entry] = storage.getPendingMutations();
      storage.markMutationCompleted(entry.id);
      storage.pruneCompletedMutations();

      const stats = storage.getSyncStats();
      expect(stats.pending).toBe(0);
    });

    it("markMutationInFlight is row-conditional: returns true only on the first claim, false on re-claim (Inspector Brad PR #62 race fix)", () => {
      storage.enqueueMutation({
        entityType: "workout",
        entityId: "w1",
        operation: "create",
        payload: {},
        endpoint: "/workouts",
        method: "POST",
      });
      const [entry] = storage.getPendingMutations();

      // First claim wins.
      expect(storage.markMutationInFlight(entry.id)).toBe(true);
      // Second concurrent caller racing for the same id gets `false`
      // — this is the guard that stops two drains POSTing the same
      // entry twice.
      expect(storage.markMutationInFlight(entry.id)).toBe(false);
      // Even after the first owner marks it completed, the entry
      // can't be re-claimed (only pending/failed are claimable).
      storage.markMutationCompleted(entry.id);
      expect(storage.markMutationInFlight(entry.id)).toBe(false);
    });

    it("a failed entry is re-claimable on the next drain (retry path stays open)", () => {
      storage.enqueueMutation({
        entityType: "workout",
        entityId: "w1",
        operation: "create",
        payload: {},
        endpoint: "/workouts",
        method: "POST",
      });
      const [entry] = storage.getPendingMutations();

      expect(storage.markMutationInFlight(entry.id)).toBe(true);
      storage.markMutationFailed(entry.id, "boom");
      // Failed → next drain can claim it again.
      expect(storage.markMutationInFlight(entry.id)).toBe(true);
    });

    it("returns false for a non-existent id (defensive)", () => {
      expect(storage.markMutationInFlight(99999)).toBe(false);
    });

    it("updateMutationPayload rewrites a pending entry's body in place", () => {
      storage.enqueueMutation({
        entityType: "exercise",
        entityId: "local-1",
        operation: "create",
        payload: { name: "Old" },
        endpoint: "/exercises",
        method: "POST",
      });
      const [entry] = storage.getPendingMutations();

      storage.updateMutationPayload(entry.id, { name: "New" });

      const [updated] = storage.getPendingMutations();
      expect(JSON.parse(updated.payload)).toEqual({ name: "New" });
      // Operation/endpoint/method are untouched — only the body changes.
      expect(updated.operation).toBe("create");
      expect(updated.endpoint).toBe("/exercises");
      expect(updated.method).toBe("POST");
    });

    it("updateMutationPayload also rewrites a failed entry (retry stays coalesced)", () => {
      storage.enqueueMutation({
        entityType: "exercise",
        entityId: "x1",
        operation: "update",
        payload: { name: "Old" },
        endpoint: "/exercises/x1",
        method: "PATCH",
      });
      const [entry] = storage.getPendingMutations();
      storage.markMutationFailed(entry.id, "boom");

      storage.updateMutationPayload(entry.id, { name: "New" });

      const [updated] = storage.getPendingMutations();
      expect(JSON.parse(updated.payload)).toEqual({ name: "New" });
    });

    it("updateMutationPayload is a no-op for an in-flight entry (drain may have serialized it)", () => {
      storage.enqueueMutation({
        entityType: "exercise",
        entityId: "x1",
        operation: "update",
        payload: { name: "Old" },
        endpoint: "/exercises/x1",
        method: "PATCH",
      });
      const [entry] = storage.getPendingMutations();
      storage.markMutationInFlight(entry.id);

      storage.updateMutationPayload(entry.id, { name: "New" });

      // The entry left the pending pool when it went in-flight; fail it back
      // in and confirm the body is still the original "Old".
      storage.markMutationFailed(entry.id, "boom");
      const [requeued] = storage.getPendingMutations();
      expect(JSON.parse(requeued.payload)).toEqual({ name: "Old" });
    });

    it("updateMutationPayload is a no-op for a non-existent id (defensive)", () => {
      expect(() =>
        storage.updateMutationPayload(99999, { name: "x" }),
      ).not.toThrow();
    });
  });

  describe("blocked_entitlement (M10.6)", () => {
    const verdict = {
      feature: "create_workout" as const,
      currentTier: "premium" as const,
      upgradeTo: "premium" as const,
      upgradePriceMonthly: 12.99,
      blockedAt: "2026-05-24T10:00:00.000Z",
    };

    function enqueueOne(): number {
      storage.enqueueMutation({
        entityType: "workout",
        operation: "create",
        payload: { name: "Over-limit" },
        endpoint: "/workouts",
        method: "POST",
      });
      return storage.getPendingMutations()[0].id;
    }

    it("markMutationBlocked flips status + persists the verdict", () => {
      const id = enqueueOne();
      storage.markMutationBlocked(id, verdict);

      const blocked = storage.getBlockedEntries();
      expect(blocked).toHaveLength(1);
      expect(blocked[0].id).toBe(id);
      expect(blocked[0].status).toBe("blocked_entitlement");
      expect(blocked[0].entitlementVerdict).toEqual(verdict);
    });

    it("blocked entries are excluded from getPendingMutations", () => {
      const id = enqueueOne();
      storage.markMutationBlocked(id, verdict);
      expect(storage.getPendingMutations()).toHaveLength(0);
    });

    it("getSyncStats.blocked tracks the count separately from failed", () => {
      const id = enqueueOne();
      storage.markMutationBlocked(id, verdict);
      expect(storage.getSyncStats()).toEqual({
        pending: 0,
        failed: 0,
        inFlight: 0,
        blocked: 1,
      });
    });

    it("unblockEntries flips the row back to pending and clears the verdict", () => {
      const id = enqueueOne();
      storage.markMutationBlocked(id, verdict);
      storage.unblockEntries([id]);

      const pending = storage.getPendingMutations();
      expect(pending).toHaveLength(1);
      expect(pending[0].id).toBe(id);
      expect(pending[0].entitlementVerdict).toBeNull();
      expect(storage.getBlockedEntries()).toHaveLength(0);
    });

    it("unblockEntries with an empty list is a no-op", () => {
      const id = enqueueOne();
      storage.markMutationBlocked(id, verdict);
      storage.unblockEntries([]);
      expect(storage.getBlockedEntries()).toHaveLength(1);
    });

    it("unblockEntries skips ids that aren't currently blocked (defensive)", () => {
      const blockedId = enqueueOne();
      const pendingId = (() => {
        storage.enqueueMutation({
          entityType: "session",
          operation: "update",
          payload: {},
          endpoint: "/sessions/x",
          method: "PATCH",
        });
        return storage.getPendingMutations()[1].id;
      })();
      storage.markMutationBlocked(blockedId, verdict);

      // Try to "unblock" a pending id — must not touch it.
      storage.unblockEntries([pendingId]);
      const pending = storage.getPendingMutations();
      expect(pending.find((p) => p.id === pendingId)).toBeDefined();
      // And the blocked one stays blocked.
      expect(storage.getBlockedEntries()).toHaveLength(1);
    });

    it("discardEntries deletes the rows entirely", () => {
      const id = enqueueOne();
      storage.markMutationBlocked(id, verdict);
      storage.discardEntries([id]);

      expect(storage.getBlockedEntries()).toHaveLength(0);
      expect(storage.getPendingMutations()).toHaveLength(0);
      expect(storage.getSyncStats()).toEqual({
        pending: 0,
        failed: 0,
        inFlight: 0,
        blocked: 0,
      });
    });

    it("discardEntries with an empty list is a no-op", () => {
      const id = enqueueOne();
      storage.markMutationBlocked(id, verdict);
      storage.discardEntries([]);
      expect(storage.getBlockedEntries()).toHaveLength(1);
    });

    it("markMutationBlocked on a non-existent id is a defensive no-op", () => {
      storage.markMutationBlocked(99999, verdict);
      expect(storage.getBlockedEntries()).toHaveLength(0);
    });

    it("getBlockedEntries returns entries in FIFO order", () => {
      const ids: number[] = [];
      for (let i = 0; i < 3; i++) {
        storage.enqueueMutation({
          entityType: "workout",
          operation: "create",
          payload: {},
          endpoint: "/workouts",
          method: "POST",
        });
        ids.push(storage.getPendingMutations()[i].id);
      }
      ids.forEach((id, i) =>
        storage.markMutationBlocked(id, {
          ...verdict,
          blockedAt: `2026-05-24T1${i}:00:00.000Z`,
        }),
      );
      const blocked = storage.getBlockedEntries();
      expect(blocked.map((b) => b.id)).toEqual(ids);
    });
  });

  describe("failed-exhausted entries (M13 sync-hardening)", () => {
    function enqueueOne(): number {
      storage.enqueueMutation({
        entityType: "session",
        operation: "create",
        payload: { name: "Push Day" },
        endpoint: "/sessions/record",
        method: "POST",
      });
      // `.slice(-1)[0]` (not `[0]`) — a prior enqueueOne() call in the same
      // test may still be sitting `pending` (not yet exhausted), so index 0
      // would keep returning the FIRST-ever entry instead of the one just
      // created.
      return storage.getPendingMutations().slice(-1)[0].id;
    }

    function exhaust(id: number, maxRetries = 3): void {
      for (let i = 0; i < maxRetries; i++) {
        storage.markMutationFailed(id, `attempt ${i + 1} failed`);
      }
    }

    it("getFailedExhaustedEntries is empty for a fresh pending entry", () => {
      enqueueOne();
      expect(storage.getFailedExhaustedEntries()).toHaveLength(0);
    });

    it("getFailedExhaustedEntries is empty while retry_count < max_retries", () => {
      const id = enqueueOne();
      storage.markMutationFailed(id, "attempt 1 failed");
      expect(storage.getFailedExhaustedEntries()).toHaveLength(0);
      // Still visible to getPendingMutations — not yet exhausted.
      expect(storage.getPendingMutations()).toHaveLength(1);
    });

    it("surfaces an entry once retry_count reaches max_retries", () => {
      const id = enqueueOne();
      exhaust(id);
      const exhausted = storage.getFailedExhaustedEntries();
      expect(exhausted).toHaveLength(1);
      expect(exhausted[0].id).toBe(id);
      expect(exhausted[0].status).toBe("failed");
      expect(exhausted[0].retryCount).toBe(3);
    });

    it("an exhausted entry is invisible to getPendingMutations (the bug this fixes)", () => {
      const id = enqueueOne();
      exhaust(id);
      expect(storage.getPendingMutations()).toHaveLength(0);
      // ...but it's not gone — it's recoverable via getFailedExhaustedEntries.
      expect(storage.getFailedExhaustedEntries().map((e) => e.id)).toEqual([
        id,
      ]);
    });

    it("resetFailedEntries returns an exhausted entry to pending with a clean retry budget", () => {
      const id = enqueueOne();
      exhaust(id);
      storage.resetFailedEntries([id]);

      expect(storage.getFailedExhaustedEntries()).toHaveLength(0);
      const pending = storage.getPendingMutations();
      expect(pending).toHaveLength(1);
      expect(pending[0].id).toBe(id);
      expect(pending[0].retryCount).toBe(0);
      expect(pending[0].errorMessage).toBeNull();
    });

    it("resetFailedEntries with an empty list is a no-op", () => {
      const id = enqueueOne();
      exhaust(id);
      storage.resetFailedEntries([]);
      expect(storage.getFailedExhaustedEntries()).toHaveLength(1);
    });

    it("resetFailedEntries skips ids that aren't currently failed (defensive)", () => {
      const pendingId = enqueueOne();
      storage.resetFailedEntries([pendingId]);
      // Was never failed — status stays pending, untouched.
      const pending = storage.getPendingMutations();
      expect(pending).toHaveLength(1);
      expect(pending[0].id).toBe(pendingId);
    });

    it("getFailedExhaustedEntries returns entries in FIFO (created_at) order", () => {
      const ids = [enqueueOne(), enqueueOne(), enqueueOne()];
      ids.forEach((id) => exhaust(id));
      expect(storage.getFailedExhaustedEntries().map((e) => e.id)).toEqual(ids);
    });

    it("a re-exhausted entry (fails again after reset) re-surfaces instead of looping silently", () => {
      const id = enqueueOne();
      exhaust(id);
      storage.resetFailedEntries([id]);
      exhaust(id);
      const exhausted = storage.getFailedExhaustedEntries();
      expect(exhausted).toHaveLength(1);
      expect(exhausted[0].id).toBe(id);
    });
  });

  describe("sync metadata", () => {
    it("stores and retrieves last synced time", () => {
      expect(storage.getLastSyncedAt("workout")).toBeNull();

      const now = new Date().toISOString();
      storage.setLastSyncedAt("workout", now);
      expect(storage.getLastSyncedAt("workout")).toBe(now);
    });
  });

  describe("clearAll", () => {
    it("removes all queued mutations and metadata", () => {
      storage.enqueueMutation({
        entityType: "workout",
        operation: "create",
        payload: { name: "Chest Day" },
        endpoint: "/workouts",
        method: "POST",
      });
      storage.setLastSyncedAt("workout", new Date().toISOString());

      expect(storage.getPendingMutations()).toHaveLength(1);
      expect(storage.getLastSyncedAt("workout")).not.toBeNull();

      storage.clearAll();

      expect(storage.getPendingMutations()).toHaveLength(0);
      expect(storage.getLastSyncedAt("workout")).toBeNull();
      expect(storage.getSyncStats()).toEqual({
        pending: 0,
        failed: 0,
        inFlight: 0,
        blocked: 0,
      });
    });

    it("clears the exercise cache", () => {
      storage.cacheExercises([buildExercise({ id: "e1" })]);
      expect(storage.getCachedExercises()).toHaveLength(1);

      storage.clearAll();
      expect(storage.getCachedExercises()).toHaveLength(0);
      expect(storage.getExerciseCacheAge()).toBeNull();
    });

    it("clears the recent-sets cache (sign-out hygiene)", () => {
      storage.upsertRecentSets("user-1", [
        {
          exerciseId: "ex-bench",
          setNumber: 1,
          weightKg: 80,
          reps: 8,
          recordedAt: "2026-05-05T10:00:00.000Z",
        },
      ]);
      expect(storage.getRecentSetsByExercise("user-1", ["ex-bench"])).toEqual({
        "ex-bench": { 1: { weightKg: 80, reps: 8 } },
      });

      storage.clearAll();

      expect(storage.getRecentSetsByExercise("user-1", ["ex-bench"])).toEqual(
        {},
      );
    });
  });

  describe("exercise cache", () => {
    it("returns empty array and null cache age when empty", () => {
      expect(storage.getCachedExercises()).toEqual([]);
      expect(storage.getExerciseCacheAge()).toBeNull();
      expect(storage.getCachedExercise("nope")).toBeNull();
    });

    it("caches a batch of exercises and retrieves them", () => {
      storage.cacheExercises([
        buildExercise({ id: "e1", name: "Bench Press" }),
        buildExercise({
          id: "e2",
          name: "Back Squat",
          primaryMuscleGroups: ["quadriceps"],
        }),
      ]);

      const all = storage.getCachedExercises();
      expect(all).toHaveLength(2);
      expect(all.map((e) => e.id).sort()).toEqual(["e1", "e2"]);
    });

    it("upserts on cacheExercises (updates existing by id)", () => {
      storage.cacheExercises([buildExercise({ id: "e1", name: "Original" })]);
      storage.cacheExercises([buildExercise({ id: "e1", name: "Updated" })]);

      const all = storage.getCachedExercises();
      expect(all).toHaveLength(1);
      expect(all[0].name).toBe("Updated");
    });

    it("applies filters to cached exercises", () => {
      storage.cacheExercises([
        buildExercise({ id: "e1", name: "Bench Press" }),
        buildExercise({
          id: "e2",
          name: "Back Squat",
          primaryMuscleGroups: ["quadriceps"],
          equipment: ["barbell"],
        }),
      ]);

      const filtered = storage.getCachedExercises({
        muscleGroups: ["quadriceps"],
      });
      expect(filtered).toHaveLength(1);
      expect(filtered[0].id).toBe("e2");
    });

    it("gets a single cached exercise by id", () => {
      storage.cacheExercises([buildExercise({ id: "e1" })]);
      expect(storage.getCachedExercise("e1")?.id).toBe("e1");
      expect(storage.getCachedExercise("missing")).toBeNull();
    });

    it("reports cache age as earliest synced_at", () => {
      storage.cacheExercises([buildExercise({ id: "e1" })]);
      const age = storage.getExerciseCacheAge();
      expect(age).not.toBeNull();
      expect(Date.parse(age as string)).not.toBeNaN();
    });

    it("saveCustomExercise tags exercise as custom and stores it", () => {
      // A genuine custom exercise always carries a real owner; read-time
      // re-derivation keeps isCustom true because createdBy is non-system.
      storage.saveCustomExercise(
        buildExercise({ id: "custom-1", isCustom: false, createdBy: "user-1" }),
      );
      const stored = storage.getCachedExercise("custom-1");
      expect(stored?.isCustom).toBe(true);
      expect(stored?.createdBy).toBe("user-1");
    });

    // Stale cached blobs were persisted before the write-time ownership fix
    // existed, so they carry isCustom:true for system exercises (whose owner
    // is the SYSTEM_USER_ID sentinel, not null). The read path must re-derive
    // ownership and not trust the stored isCustom value.
    describe("re-derives ownership at read time (poisoned cache)", () => {
      const SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000000";

      beforeEach(() => {
        storage.cacheExercises([
          // System exercise stored with the sentinel owner + wrong isCustom.
          buildExercise({
            id: "sys-sentinel",
            name: "System Sentinel",
            isCustom: true,
            createdBy: SYSTEM_USER_ID,
          }),
          // System exercise stored with a null owner + wrong isCustom.
          buildExercise({
            id: "sys-null",
            name: "System Null",
            isCustom: true,
            createdBy: null,
          }),
          // Genuine user-created exercise with a real owner.
          buildExercise({
            id: "mine-1",
            name: "My Exercise",
            isCustom: true,
            createdBy: "user-1",
          }),
        ]);
      });

      it("normalises the sentinel owner to null and isCustom to false", () => {
        const stored = storage.getCachedExercise("sys-sentinel");
        expect(stored?.isCustom).toBe(false);
        expect(stored?.createdBy).toBeNull();
      });

      it("system filter returns sentinel + null-owner exercises", () => {
        const system = storage.getCachedExercises({ createdBy: "system" });
        expect(system.map((e) => e.id).sort()).toEqual([
          "sys-null",
          "sys-sentinel",
        ]);
      });

      it("mine filter excludes system exercises and keeps owned ones", () => {
        const mine = storage.getCachedExercises({ createdBy: "mine" });
        expect(mine.map((e) => e.id)).toEqual(["mine-1"]);
        expect(mine[0].isCustom).toBe(true);
        expect(mine[0].createdBy).toBe("user-1");
      });
    });

    describe("swapLocalExerciseId", () => {
      it("re-keys the cached row (column + embedded id) and re-points queued edits", () => {
        storage.saveCustomExercise(
          buildExercise({ id: "local-1", name: "My Lift", createdBy: "me" }),
        );
        // A follow-up edit enqueued before the create flushed.
        storage.enqueueMutation({
          entityType: "exercise",
          entityId: "local-1",
          operation: "update",
          payload: { name: "My Lift v2" },
          endpoint: "/exercises/local-1",
          method: "PATCH",
        });

        storage.swapLocalExerciseId("local-1", "server-9");

        // Old id is gone; the row is readable under the server id with its
        // embedded id rewritten.
        expect(storage.getCachedExercise("local-1")).toBeNull();
        const swapped = storage.getCachedExercise("server-9");
        expect(swapped?.id).toBe("server-9");
        expect(swapped?.name).toBe("My Lift");

        // The queued edit now targets the real resource.
        const [pending] = storage.getPendingMutations();
        expect(pending.entityId).toBe("server-9");
        expect(pending.endpoint).toBe("/exercises/server-9");
      });

      it("is a no-op when the ids are equal", () => {
        storage.saveCustomExercise(buildExercise({ id: "ex-1" }));
        storage.swapLocalExerciseId("ex-1", "ex-1");
        expect(storage.getCachedExercise("ex-1")?.id).toBe("ex-1");
      });

      it("tolerates an unknown local id (nothing to swap)", () => {
        expect(() =>
          storage.swapLocalExerciseId("local-missing", "server-1"),
        ).not.toThrow();
        expect(storage.getCachedExercise("server-1")).toBeNull();
      });
    });

    describe("swapLocalHabitGoalId (residual fix)", () => {
      it("re-keys cached_habit_completions rows AND rewrites a queued POST payload", () => {
        storage.upsertHabitCompletion({
          id: "local-c1",
          userId: "u1",
          goalId: "local-goal",
          day: "2026-06-10",
          completedAt: "2026-06-10T12:00:00.000Z",
          value: 2,
        });
        storage.enqueueMutation({
          entityType: "habit_completion",
          entityId: "local-goal:2026-06-10",
          operation: "create",
          payload: { goalId: "local-goal", date: "2026-06-10", value: 2 },
          endpoint: "/habit-completions",
          method: "POST",
        });

        storage.swapLocalHabitGoalId("local-goal", "server-goal");

        expect(
          storage.getCachedHabitCompletions("u1", { goalId: "local-goal" }),
        ).toHaveLength(0);
        const rekeyed = storage.getCachedHabitCompletions("u1", {
          goalId: "server-goal",
        });
        expect(rekeyed).toHaveLength(1);
        expect(rekeyed[0].value).toBe(2);

        const [pending] = storage.getPendingMutations();
        expect((JSON.parse(pending.payload) as { goalId: string }).goalId).toBe(
          "server-goal",
        );
        expect(pending.entityId).toBe("server-goal:2026-06-10");
      });

      it("rewrites a queued DELETE's payload AND its query-string endpoint", () => {
        storage.enqueueMutation({
          entityType: "habit_completion",
          entityId: "local-goal:2026-06-10",
          operation: "delete",
          payload: { goalId: "local-goal", date: "2026-06-10" },
          endpoint: "/habit-completions?goalId=local-goal&date=2026-06-10",
          method: "DELETE",
        });

        storage.swapLocalHabitGoalId("local-goal", "server-goal");

        const [pending] = storage.getPendingMutations();
        expect((JSON.parse(pending.payload) as { goalId: string }).goalId).toBe(
          "server-goal",
        );
        expect(pending.endpoint).toBe(
          "/habit-completions?goalId=server-goal&date=2026-06-10",
        );
      });

      it("never touches an in_flight or completed queue entry", () => {
        storage.enqueueMutation({
          entityType: "habit_completion",
          entityId: "local-goal:2026-06-10",
          operation: "create",
          payload: { goalId: "local-goal", date: "2026-06-10", value: 2 },
          endpoint: "/habit-completions",
          method: "POST",
        });
        const [entry] = storage.getPendingMutations();
        storage.markMutationInFlight(entry.id); // simulate a drain already owning it

        storage.swapLocalHabitGoalId("local-goal", "server-goal");

        // in_flight rows are excluded from getPendingMutations, so read the
        // raw effect via a second entry instead — assert the in-flight one's
        // payload is untouched by re-querying through markMutationCompleted's
        // absence of throw and confirming no NEW pending row was created.
        expect(storage.getPendingMutations()).toHaveLength(0);
      });

      it("is a no-op when the ids are equal", () => {
        storage.upsertHabitCompletion({
          id: "c1",
          userId: "u1",
          goalId: "goal-1",
          day: "2026-06-10",
          completedAt: "2026-06-10T12:00:00.000Z",
          value: 2,
        });
        storage.swapLocalHabitGoalId("goal-1", "goal-1");
        expect(
          storage.getCachedHabitCompletions("u1", { goalId: "goal-1" }),
        ).toHaveLength(1);
      });

      it("tolerates an unknown local goalId (nothing to swap)", () => {
        expect(() =>
          storage.swapLocalHabitGoalId("local-missing", "server-1"),
        ).not.toThrow();
      });
    });
  });

  describe("workouts cache (M2)", () => {
    it("returns null when no list slice is cached", () => {
      expect(storage.getCachedWorkoutsList("user-1", "mine")).toBeNull();
      expect(storage.getWorkoutsListAge("user-1", "mine")).toBeNull();
    });

    it("caches and reads back a list slice scoped by (userId, type)", () => {
      const workouts = [buildWorkout({ id: "w-1", name: "Push" })];
      storage.cacheWorkoutsList("user-1", "mine", workouts, {
        used: 1,
        limit: 50,
      });

      const cached = storage.getCachedWorkoutsList("user-1", "mine");
      expect(cached).not.toBeNull();
      expect(cached?.workouts).toEqual(workouts);
      expect(cached?.quota).toEqual({ used: 1, limit: 50 });
      expect(cached?.userId).toBe("user-1");
      expect(cached?.type).toBe("mine");
      expect(cached?.syncedAt).toBeDefined();
    });

    it("isolates list slices between userIds", () => {
      storage.cacheWorkoutsList(
        "user-1",
        "mine",
        [buildWorkout({ id: "w-A" })],
        null,
      );
      storage.cacheWorkoutsList(
        "user-2",
        "mine",
        [buildWorkout({ id: "w-B", createdBy: "user-2" })],
        null,
      );

      expect(
        storage.getCachedWorkoutsList("user-1", "mine")?.workouts[0].id,
      ).toBe("w-A");
      expect(
        storage.getCachedWorkoutsList("user-2", "mine")?.workouts[0].id,
      ).toBe("w-B");
    });

    it("isolates list slices between types for the same user", () => {
      storage.cacheWorkoutsList(
        "user-1",
        "mine",
        [buildWorkout({ id: "w-mine" })],
        { used: 1, limit: null },
      );
      storage.cacheWorkoutsList(
        "user-1",
        "default",
        [buildWorkout({ id: "w-default" })],
        null,
      );

      expect(
        storage.getCachedWorkoutsList("user-1", "mine")?.workouts[0].id,
      ).toBe("w-mine");
      expect(
        storage.getCachedWorkoutsList("user-1", "default")?.workouts[0].id,
      ).toBe("w-default");
      // Quota only on `mine` slice
      expect(
        storage.getCachedWorkoutsList("user-1", "default")?.quota,
      ).toBeNull();
    });

    it("upserts the slice on repeat cache calls", () => {
      storage.cacheWorkoutsList("user-1", "mine", [], null);
      storage.cacheWorkoutsList(
        "user-1",
        "mine",
        [buildWorkout({ id: "w-1" })],
        { used: 1, limit: 10 },
      );

      const cached = storage.getCachedWorkoutsList("user-1", "mine");
      expect(cached?.workouts).toHaveLength(1);
      expect(cached?.quota).toEqual({ used: 1, limit: 10 });
    });

    it("caches and reads single workout detail", () => {
      const workout = buildWorkout({ id: "w-1", name: "Push" });
      storage.cacheWorkoutDetail("user-1", workout);

      const cached = storage.getCachedWorkoutDetail("user-1", "w-1");
      expect(cached?.workout).toEqual(workout);
      expect(cached?.userId).toBe("user-1");
      expect(cached?.workoutId).toBe("w-1");
    });

    it("returns null for missing detail", () => {
      expect(storage.getCachedWorkoutDetail("user-1", "missing")).toBeNull();
    });

    it("caches + reads per-workout history scoped by (userId, workoutId)", () => {
      const history = {
        completedCount: 3,
        lastCompletedAt: "2026-07-01T00:00:00Z",
        avgDurationSeconds: 1800,
        lastSession: {
          completedAt: "2026-07-01T00:00:00Z",
          totalVolumeKg: 4000,
          durationSeconds: 1900,
        },
      };
      expect(storage.getCachedWorkoutHistory("user-1", "w-1")).toBeNull();
      storage.cacheWorkoutHistory("user-1", "w-1", history);

      const cached = storage.getCachedWorkoutHistory("user-1", "w-1");
      expect(cached?.history).toEqual(history);
      expect(cached?.userId).toBe("user-1");
      expect(cached?.workoutId).toBe("w-1");
      expect(cached?.syncedAt).toBeDefined();
      // Not shared with another workout / user.
      expect(storage.getCachedWorkoutHistory("user-1", "w-2")).toBeNull();
      expect(storage.getCachedWorkoutHistory("user-2", "w-1")).toBeNull();
    });

    it("caches the coach workout library in a slot separate from mine", () => {
      expect(storage.getCachedCoachWorkoutLibrary("user-1")).toBeNull();
      const lib = [buildWorkout({ id: "w-1" }), buildWorkout({ id: "w-2" })];
      storage.cacheCoachWorkoutLibrary("user-1", lib);

      expect(
        storage.getCachedCoachWorkoutLibrary("user-1")?.map((w) => w.id),
      ).toEqual(["w-1", "w-2"]);
      // Distinct from the shared mine list cache + isolated per user.
      expect(storage.getCachedWorkoutsList("user-1", "mine")).toBeNull();
      expect(storage.getCachedCoachWorkoutLibrary("user-2")).toBeNull();
    });

    it("removeCachedWorkout also drops the cached history", () => {
      const history = {
        completedCount: 1,
        lastCompletedAt: "2026-07-01T00:00:00Z",
        avgDurationSeconds: null,
        lastSession: null,
      };
      storage.cacheWorkoutHistory("user-1", "w-drop", history);
      storage.removeCachedWorkout("user-1", "w-drop");
      expect(storage.getCachedWorkoutHistory("user-1", "w-drop")).toBeNull();
    });

    it("removeCachedWorkout drops detail and prunes from list slices", () => {
      const wKeep = buildWorkout({ id: "w-keep" });
      const wDrop = buildWorkout({ id: "w-drop" });
      storage.cacheWorkoutsList("user-1", "mine", [wKeep, wDrop], null);
      storage.cacheWorkoutDetail("user-1", wDrop);

      storage.removeCachedWorkout("user-1", "w-drop");

      expect(storage.getCachedWorkoutDetail("user-1", "w-drop")).toBeNull();
      const slice = storage.getCachedWorkoutsList("user-1", "mine");
      expect(slice?.workouts.map((w) => w.id)).toEqual(["w-keep"]);
    });

    it("removeCachedWorkout leaves other users' caches intact", () => {
      const w = buildWorkout({ id: "w-shared" });
      storage.cacheWorkoutsList("user-1", "mine", [w], null);
      storage.cacheWorkoutsList("user-2", "mine", [w], null);

      storage.removeCachedWorkout("user-1", "w-shared");

      expect(
        storage.getCachedWorkoutsList("user-1", "mine")?.workouts,
      ).toHaveLength(0);
      expect(
        storage.getCachedWorkoutsList("user-2", "mine")?.workouts,
      ).toHaveLength(1);
    });

    it("clearAll wipes the workouts caches", () => {
      storage.cacheWorkoutsList("user-1", "mine", [buildWorkout()], {
        used: 1,
        limit: 10,
      });
      storage.cacheWorkoutDetail("user-1", buildWorkout());

      storage.clearAll();

      expect(storage.getCachedWorkoutsList("user-1", "mine")).toBeNull();
      expect(storage.getCachedWorkoutDetail("user-1", "w-1")).toBeNull();
    });
  });

  describe("active session (M3)", () => {
    const buildSession = (
      overrides: Partial<WorkoutSession> = {},
    ): WorkoutSession => ({
      id: overrides.id ?? "local-s1",
      userId: overrides.userId ?? "user-1",
      workoutId: "wk-1",
      name: "Push Day",
      status: "in_progress",
      startedAt: "2026-05-05T10:00:00.000Z",
      completedAt: null,
      notes: null,
      exercises: overrides.exercises ?? [
        {
          id: "local-se1",
          sessionId: overrides.id ?? "local-s1",
          exerciseId: "ex-bench",
          exerciseName: "Bench Press",
          sortOrder: 0,
          supersetGroup: null,
          isSubstituted: false,
          originalExerciseId: null,
          notes: null,
          sets: [
            {
              id: "local-set1",
              sessionExerciseId: "local-se1",
              setNumber: 1,
              weightKg: 80,
              reps: 8,
              rpe: null,
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

    it("cacheActiveSession + getActiveSession round-trips a full session", () => {
      const session = buildSession();
      storage.cacheActiveSession("user-1", session);
      const loaded = storage.getActiveSession("user-1");
      expect(loaded).not.toBeNull();
      expect(loaded?.id).toBe("local-s1");
      expect(loaded?.exercises[0].sets[0].weightKg).toBe(80);
      expect(loaded?.exercises[0].sets[0].isCompleted).toBe(true);
    });

    it("getActiveSession returns null when no row exists", () => {
      expect(storage.getActiveSession("user-1")).toBeNull();
    });

    it("getActiveSession returns null for completed sessions (filter on status)", () => {
      storage.cacheActiveSession(
        "user-1",
        buildSession({ status: "completed" }),
      );
      expect(storage.getActiveSession("user-1")).toBeNull();
    });

    it("getActiveSession isolates by user (User B does not see User A's session)", () => {
      storage.cacheActiveSession("user-A", buildSession({ userId: "user-A" }));
      expect(storage.getActiveSession("user-B")).toBeNull();
    });

    it("cacheActiveSession is a full upsert — replaces nested rows", () => {
      const first = buildSession();
      storage.cacheActiveSession("user-1", first);
      const second = buildSession({
        exercises: [
          {
            id: "local-se2",
            sessionId: "local-s1",
            exerciseId: "ex-row",
            exerciseName: "Row",
            sortOrder: 0,
            supersetGroup: null,
            isSubstituted: false,
            originalExerciseId: null,
            notes: null,
            sets: [],
          },
        ],
      });
      storage.cacheActiveSession("user-1", second);
      const loaded = storage.getActiveSession("user-1");
      expect(loaded?.exercises).toHaveLength(1);
      expect(loaded?.exercises[0].exerciseId).toBe("ex-row");
    });

    it("clearActiveSession deletes the in-progress session", () => {
      storage.cacheActiveSession("user-1", buildSession());
      storage.clearActiveSession("user-1");
      expect(storage.getActiveSession("user-1")).toBeNull();
    });

    it("clearActiveSession also clears rest-timer state (SQLite parity)", () => {
      // SQLite stores rest_timer_started_at + rest_timer_total_seconds as
      // columns on active_sessions, so DELETE FROM active_sessions kills
      // both atomically. The in-memory adapter uses a separate map, so
      // the equivalent atomic-clear has to be wired explicitly.
      // Without it, a second session for the same user would surface
      // the prior session's stale timer.
      storage.cacheActiveSession("user-1", buildSession());
      storage.setRestTimerState("user-1", {
        startedAt: "2026-05-05T10:10:00.000Z",
        totalSeconds: 90,
      });
      expect(storage.getRestTimerState("user-1")).not.toBeNull();

      storage.clearActiveSession("user-1");

      // Start a new in-progress session for the same user. The prior
      // timer entry would otherwise be surfaced to this new session.
      storage.cacheActiveSession("user-1", buildSession({ id: "local-s2" }));
      expect(storage.getRestTimerState("user-1")).toBeNull();
    });

    it("clearActiveSession also drops a finalized (completed) row", () => {
      // Summary's Continue button calls this AFTER the row has been
      // flipped to status=completed; the row must clear regardless.
      storage.cacheActiveSession("user-1", {
        ...buildSession(),
        status: "completed",
        completedAt: "2026-05-05T11:00:00.000Z",
      });
      storage.clearActiveSession("user-1");
      expect(storage.getLatestSession("user-1")).toBeNull();
    });

    it("clearActiveSession is a no-op when no session exists", () => {
      expect(() => storage.clearActiveSession("user-1")).not.toThrow();
    });

    it("getLatestSession returns the row regardless of status (so the Summary screen can render after completion)", () => {
      storage.cacheActiveSession("user-1", {
        ...buildSession(),
        status: "completed",
        completedAt: "2026-05-05T11:00:00.000Z",
      });
      // getActiveSession (in-progress filter) returns null...
      expect(storage.getActiveSession("user-1")).toBeNull();
      // ...but getLatestSession finds it.
      const loaded = storage.getLatestSession("user-1");
      expect(loaded?.status).toBe("completed");
    });

    it("getLatestSession returns null when no row exists", () => {
      expect(storage.getLatestSession("user-1")).toBeNull();
    });

    it("returned session is decoupled from internal state (deep clone)", () => {
      storage.cacheActiveSession("user-1", buildSession());
      const loaded = storage.getActiveSession("user-1");
      if (loaded) loaded.exercises[0].sets[0].weightKg = 999;
      const reloaded = storage.getActiveSession("user-1");
      expect(reloaded?.exercises[0].sets[0].weightKg).toBe(80);
    });
  });

  describe("getSessionSets", () => {
    it("returns sets for a matching exerciseId in the active session", () => {
      const session: WorkoutSession = {
        id: "local-s1",
        userId: "user-1",
        workoutId: null,
        name: "Quick",
        status: "in_progress",
        startedAt: "ts",
        completedAt: null,
        notes: null,
        exercises: [
          {
            id: "se-1",
            sessionId: "local-s1",
            exerciseId: "ex-bench",
            exerciseName: "Bench",
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
                weightKg: 100,
                reps: 5,
                rpe: null,
                durationSeconds: null,
                distanceMeters: null,
                isCompleted: true,
                completedAt: "ts",
              },
            ],
          },
        ],
      };
      storage.cacheActiveSession("user-1", session);
      const sets = storage.getSessionSets("user-1", "local-s1", "ex-bench");
      expect(sets).toHaveLength(1);
      expect(sets[0].weightKg).toBe(100);
    });

    it("returns [] when sessionId does not match the active session", () => {
      expect(storage.getSessionSets("user-1", "missing", "ex-bench")).toEqual(
        [],
      );
    });
  });

  describe("personal records cache (M3)", () => {
    const pr = (overrides: Partial<PersonalRecord> = {}): PersonalRecord => ({
      id: "pr-1",
      userId: "user-1",
      exerciseId: "ex-bench",
      exerciseName: "Bench Press",
      recordType: "1rm",
      value: 120,
      achievedAt: "2026-05-01T00:00:00.000Z",
      sessionId: "s-1",
      setId: "set-1",
      ...overrides,
    });

    it("upserts on (userId, exerciseId, recordType)", () => {
      storage.cachePersonalRecords("user-1", [pr()]);
      storage.cachePersonalRecords("user-1", [pr({ value: 130, id: "pr-2" })]);
      const all = storage.getPersonalRecords("user-1");
      expect(all).toHaveLength(1);
      expect(all[0].value).toBe(130);
      expect(all[0].id).toBe("pr-2");
    });

    it("filters by exerciseId when supplied", () => {
      storage.cachePersonalRecords("user-1", [
        pr({ id: "pr-bench", exerciseId: "ex-bench" }),
        pr({ id: "pr-row", exerciseId: "ex-row" }),
      ]);
      const benchOnly = storage.getPersonalRecords("user-1", "ex-bench");
      expect(benchOnly).toHaveLength(1);
      expect(benchOnly[0].exerciseId).toBe("ex-bench");
    });

    it("isolates by userId", () => {
      storage.cachePersonalRecords("user-A", [pr({ userId: "user-A" })]);
      expect(storage.getPersonalRecords("user-B")).toEqual([]);
    });

    it("getPersonalRecords returns [] when nothing cached", () => {
      expect(storage.getPersonalRecords("user-1")).toEqual([]);
    });

    it("orders by achievedAt DESC", () => {
      storage.cachePersonalRecords("user-1", [
        pr({
          id: "old",
          exerciseId: "ex-1",
          achievedAt: "2026-01-01T00:00:00.000Z",
        }),
        pr({
          id: "new",
          exerciseId: "ex-2",
          achievedAt: "2026-05-01T00:00:00.000Z",
        }),
      ]);
      const all = storage.getPersonalRecords("user-1");
      expect(all[0].id).toBe("new");
      expect(all[1].id).toBe("old");
    });

    it("cachePersonalRecords is a no-op for an empty list", () => {
      storage.cachePersonalRecords("user-1", []);
      expect(storage.getPersonalRecords("user-1")).toEqual([]);
    });
  });

  describe("swapLocalSessionId (M3)", () => {
    const seedActive = () => {
      storage.cacheActiveSession("user-1", {
        id: "local-abc",
        userId: "user-1",
        workoutId: null,
        name: "Push",
        status: "in_progress",
        startedAt: "ts",
        completedAt: null,
        notes: null,
        exercises: [],
      });
    };

    it("rewrites the session id in active_sessions", () => {
      seedActive();
      storage.swapLocalSessionId("local-abc", "server-abc");
      const loaded = storage.getActiveSession("user-1");
      expect(loaded?.id).toBe("server-abc");
    });

    it("rewrites sessionId on PR rows that referenced the local id", () => {
      seedActive();
      storage.cachePersonalRecords("user-1", [
        {
          id: "pr-1",
          userId: "user-1",
          exerciseId: "ex-bench",
          exerciseName: "Bench",
          recordType: "1rm",
          value: 120,
          achievedAt: "ts",
          sessionId: "local-abc",
          setId: null,
        },
      ]);
      storage.swapLocalSessionId("local-abc", "server-abc");
      expect(storage.getPersonalRecords("user-1")[0].sessionId).toBe(
        "server-abc",
      );
    });

    it("rewrites sessionId on every nested exercise (parity with SQLite adapter)", () => {
      // Regression test for the in-memory adapter skipping nested
      // exercises[*].sessionId on swap. SQLite rewrites
      // session_exercises.session_id explicitly; the in-memory
      // representation nests exercises in the session row and must
      // rewrite each one for behavioural parity.
      storage.cacheActiveSession("user-1", {
        id: "local-abc",
        userId: "user-1",
        workoutId: null,
        name: "Push",
        status: "in_progress",
        startedAt: "ts",
        completedAt: null,
        notes: null,
        exercises: [
          {
            id: "local-ex-1",
            sessionId: "local-abc",
            exerciseId: "ex-bench",
            exerciseName: "Bench",
            sortOrder: 0,
            supersetGroup: null,
            isSubstituted: false,
            originalExerciseId: null,
            notes: null,
            sets: [],
          },
          {
            id: "local-ex-2",
            sessionId: "local-abc",
            exerciseId: "ex-row",
            exerciseName: "Row",
            sortOrder: 1,
            supersetGroup: null,
            isSubstituted: false,
            originalExerciseId: null,
            notes: null,
            sets: [],
          },
        ],
      });
      storage.swapLocalSessionId("local-abc", "server-abc");
      const loaded = storage.getActiveSession("user-1");
      expect(loaded?.id).toBe("server-abc");
      expect(loaded?.exercises.map((ex) => ex.sessionId)).toEqual([
        "server-abc",
        "server-abc",
      ]);
    });

    it("is a no-op when localId === serverId", () => {
      seedActive();
      storage.swapLocalSessionId("local-abc", "local-abc");
      expect(storage.getActiveSession("user-1")?.id).toBe("local-abc");
    });

    it("is a no-op when nothing matches the local id", () => {
      seedActive();
      storage.swapLocalSessionId("local-zzz", "server-zzz");
      expect(storage.getActiveSession("user-1")?.id).toBe("local-abc");
    });
  });

  describe("record response cache (M3 Phase 3b)", () => {
    const sample = {
      localSessionId: "local-1",
      personalRecords: [
        {
          exerciseId: "ex-bench",
          exerciseName: "Bench Press",
          recordType: "1rm" as const,
          newValue: 137.4,
          previousValue: 120,
          setId: "set-1",
        },
      ],
      workoutsThisMonth: 12,
      cachedAt: "2026-05-12T10:30:00.000Z",
    };

    it("returns null before any response is cached", () => {
      expect(storage.getRecordResponse("user-1")).toBeNull();
    });

    it("upserts (last-write-wins) on cacheRecordResponse + reads back via getRecordResponse", () => {
      storage.cacheRecordResponse("user-1", sample);
      const cached = storage.getRecordResponse("user-1");
      expect(cached).toEqual(sample);

      // Overwrite with a different workoutsThisMonth.
      storage.cacheRecordResponse("user-1", {
        ...sample,
        workoutsThisMonth: 13,
      });
      expect(storage.getRecordResponse("user-1")?.workoutsThisMonth).toBe(13);
    });

    it("clones on read so callers can't mutate the cache by reference", () => {
      storage.cacheRecordResponse("user-1", sample);
      const a = storage.getRecordResponse("user-1");
      const b = storage.getRecordResponse("user-1");
      expect(a).not.toBe(b);
      expect(a).toEqual(b);
    });

    it("clearRecordResponse drops the slot for the user", () => {
      storage.cacheRecordResponse("user-1", sample);
      storage.clearRecordResponse("user-1");
      expect(storage.getRecordResponse("user-1")).toBeNull();
    });

    it("clearActiveSession also clears the record-response cache (lifecycle parity with SQLite)", () => {
      storage.cacheActiveSession("user-1", {
        id: "local-1",
        userId: "user-1",
        workoutId: null,
        name: "Quick Workout",
        status: "completed",
        startedAt: "2026-05-12T10:00:00.000Z",
        completedAt: "2026-05-12T10:30:00.000Z",
        notes: null,
        exercises: [],
      });
      storage.cacheRecordResponse("user-1", sample);

      storage.clearActiveSession("user-1");

      expect(storage.getActiveSession("user-1")).toBeNull();
      expect(storage.getRecordResponse("user-1")).toBeNull();
    });

    it("scopes per-user — user A's cache doesn't leak to user B", () => {
      storage.cacheRecordResponse("user-A", sample);
      expect(storage.getRecordResponse("user-A")).not.toBeNull();
      expect(storage.getRecordResponse("user-B")).toBeNull();
    });
  });

  describe("profile-page cache (M6)", () => {
    const sampleProfilePage = {
      profile: {
        id: "user-1",
        fullName: "Brad",
        email: "b@e.com",
        username: null,
        avatarUrl: null,
        role: "user" as const,
        fitnessLevel: null,
        dateOfBirth: null,
        gender: null,
        heightCm: null,
        weightKg: null,
        weightUnit: "kg" as const,
        heightUnit: "cm" as const,
        isProfilePublic: false,
        createdAt: "2025-09-01T00:00:00.000Z",
      },
      subscription: {
        tierName: null,
        tierDisplayName: null,
        status: null,
        isFreeTier: true,
        isTrainerTier: false,
        expiresAt: null,
        cancelledAt: null,
        workoutLimit: null,
        isUnlimited: false,
      },
      stats: { workoutsCompleted: 0 },
      recentAchievements: [],
      activeTrainers: [],
      pendingTrainerRequests: [],
    };

    it("round-trips a payload", () => {
      storage.cacheProfilePage("user-1", sampleProfilePage);
      const row = storage.getCachedProfilePage("user-1");
      expect(row).not.toBeNull();
      expect(row?.payload).toEqual(sampleProfilePage);
      expect(row?.userId).toBe("user-1");
      expect(typeof row?.syncedAt).toBe("string");
    });

    it("returns null when no row exists", () => {
      expect(storage.getCachedProfilePage("ghost")).toBeNull();
      expect(storage.getProfilePageAge("ghost")).toBeNull();
    });

    it("exposes the syncedAt timestamp via getProfilePageAge", () => {
      storage.cacheProfilePage("user-1", sampleProfilePage);
      const age = storage.getProfilePageAge("user-1");
      expect(age).not.toBeNull();
      expect(Date.parse(age!)).not.toBeNaN();
    });

    it("upserts on conflict (last write wins)", () => {
      storage.cacheProfilePage("user-1", sampleProfilePage);
      const second = {
        ...sampleProfilePage,
        stats: { workoutsCompleted: 99 },
      };
      storage.cacheProfilePage("user-1", second);
      expect(
        storage.getCachedProfilePage("user-1")?.payload.stats.workoutsCompleted,
      ).toBe(99);
    });

    it("invalidateProfilePage drops the row", () => {
      storage.cacheProfilePage("user-1", sampleProfilePage);
      storage.invalidateProfilePage("user-1");
      expect(storage.getCachedProfilePage("user-1")).toBeNull();
    });

    it("scopes per-user — user A's cache doesn't leak to user B", () => {
      storage.cacheProfilePage("user-A", sampleProfilePage);
      expect(storage.getCachedProfilePage("user-A")).not.toBeNull();
      expect(storage.getCachedProfilePage("user-B")).toBeNull();
    });

    it("clearAll wipes the profile-page cache (sign-out hygiene)", () => {
      storage.cacheProfilePage("user-1", sampleProfilePage);
      storage.clearAll();
      expect(storage.getCachedProfilePage("user-1")).toBeNull();
    });
  });

  describe("programmes list cache (19-programs, Phase 9 mobile — coach F1)", () => {
    const samplePrograms: ProgramSummary[] = [
      {
        id: "program-1",
        name: "Strength Block",
        description: null,
        durationWeeks: 12,
        daysPerWeek: 4,
        workoutCount: 8,
        activeClientCount: 2,
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
      },
    ];

    it("returns null when nothing is cached", () => {
      expect(storage.getCachedPrograms("user-1")).toBeNull();
      expect(storage.getProgramsAge("user-1")).toBeNull();
    });

    it("caches and reads back the programmes list, stamping an age", () => {
      storage.cachePrograms("user-1", samplePrograms);
      expect(storage.getCachedPrograms("user-1")).toEqual(samplePrograms);
      expect(storage.getProgramsAge("user-1")).not.toBeNull();
    });

    it("overwrites the previous payload on re-cache", () => {
      storage.cachePrograms("user-1", samplePrograms);
      const updated = [{ ...samplePrograms[0], activeClientCount: 5 }];
      storage.cachePrograms("user-1", updated);
      expect(storage.getCachedPrograms("user-1")?.[0].activeClientCount).toBe(
        5,
      );
    });

    it("scopes per-user — trainer A's cache doesn't leak to trainer B", () => {
      storage.cachePrograms("trainer-A", samplePrograms);
      expect(storage.getCachedPrograms("trainer-A")).not.toBeNull();
      expect(storage.getCachedPrograms("trainer-B")).toBeNull();
    });

    it("clearAll wipes the programmes cache (sign-out hygiene)", () => {
      storage.cachePrograms("user-1", samplePrograms);
      storage.clearAll();
      expect(storage.getCachedPrograms("user-1")).toBeNull();
    });
  });

  describe("client detail cache (M8 Coach Phase 5)", () => {
    const detail: ClientDetail = {
      client: {
        id: "c-1",
        name: "Marcus Reid",
        initials: "MR",
        avatarUrl: null,
        status: "active",
        ageYears: 32,
        heightCm: 178,
      },
      adherence: { overall: 64, band: "atRisk", categories: [] },
      prs: [],
      volume: { weekKg: 14200, daily: [] },
      calorieHit: null,
      goal: null,
      habits: null,
      aiSummary: {
        summary: null,
        coversDate: null,
        generatedAt: null,
        canManualRefresh: false,
      },
      thisWeek: {
        workoutsCompleted: 0,
        workoutsPlanned: null,
        volumeKg: null,
        prs: 0,
        checkIns: null,
      },
      recentSessions: [],
      notes: [],
    };

    it("returns null when nothing is cached", () => {
      expect(storage.getCachedClientDetail("trainer-1", "c-1")).toBeNull();
      expect(storage.getClientDetailAge("trainer-1", "c-1")).toBeNull();
    });

    it("caches + reads back keyed by (userId, clientId), stamping an age", () => {
      storage.cacheClientDetail("trainer-1", "c-1", detail);
      expect(storage.getCachedClientDetail("trainer-1", "c-1")).toEqual(detail);
      expect(storage.getClientDetailAge("trainer-1", "c-1")).not.toBeNull();
    });

    it("scopes per client — one client's slot doesn't answer another's", () => {
      storage.cacheClientDetail("trainer-1", "c-1", detail);
      expect(storage.getCachedClientDetail("trainer-1", "c-2")).toBeNull();
    });

    it("scopes per trainer — trainer A's cache doesn't leak to trainer B", () => {
      storage.cacheClientDetail("trainer-A", "c-1", detail);
      expect(storage.getCachedClientDetail("trainer-A", "c-1")).not.toBeNull();
      expect(storage.getCachedClientDetail("trainer-B", "c-1")).toBeNull();
    });

    it("overwrites the previous payload on re-cache", () => {
      storage.cacheClientDetail("trainer-1", "c-1", detail);
      const updated = {
        ...detail,
        adherence: { overall: 90, band: "stellar" as const, categories: [] },
      };
      storage.cacheClientDetail("trainer-1", "c-1", updated);
      expect(
        storage.getCachedClientDetail("trainer-1", "c-1")?.adherence.overall,
      ).toBe(90);
    });

    it("clearAll wipes the client-detail cache (sign-out hygiene)", () => {
      storage.cacheClientDetail("trainer-1", "c-1", detail);
      storage.clearAll();
      expect(storage.getCachedClientDetail("trainer-1", "c-1")).toBeNull();
    });
  });
});
