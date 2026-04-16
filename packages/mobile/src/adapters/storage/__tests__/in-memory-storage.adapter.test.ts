import { InMemoryStorageAdapter } from "./in-memory-storage.adapter";

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
  });
});
