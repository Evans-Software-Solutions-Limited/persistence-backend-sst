import { InMemoryStorageAdapter } from "./in-memory-storage.adapter";
import type { Exercise } from "@/domain/models/exercise";

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
      });
    });

    it("clears the exercise cache", () => {
      storage.cacheExercises([buildExercise({ id: "e1" })]);
      expect(storage.getCachedExercises()).toHaveLength(1);

      storage.clearAll();
      expect(storage.getCachedExercises()).toHaveLength(0);
      expect(storage.getExerciseCacheAge()).toBeNull();
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
      storage.saveCustomExercise(
        buildExercise({ id: "custom-1", isCustom: false }),
      );
      const stored = storage.getCachedExercise("custom-1");
      expect(stored?.isCustom).toBe(true);
    });
  });
});
