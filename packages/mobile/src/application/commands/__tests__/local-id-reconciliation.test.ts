import { processSyncQueue } from "../sync.command";
import { deleteExerciseCommand } from "../delete-exercise.command";
import { updateExerciseCommand } from "../update-exercise.command";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import { InMemoryAuthAdapter } from "@/adapters/auth/__tests__/in-memory-auth.adapter";
import type { ApiPort } from "@/domain/ports/api.port";
import type { Exercise } from "@/domain/models/exercise";
import { ok } from "@/shared/errors";

jest.mock("@/lib/sentry", () => ({ captureSyncFailure: jest.fn() }));

const mockFetch = jest.fn();
(globalThis as Record<string, unknown>).fetch = mockFetch;

const localExercise = (id: string): Exercise => ({
  id,
  name: "My Lift",
  description: null,
  instructions: null,
  category: "strength",
  difficulty: "intermediate",
  primaryMuscleGroups: ["chest"],
  secondaryMuscleGroups: [],
  equipment: ["barbell"],
  videoUrl: null,
  thumbnailUrl: null,
  isCustom: true,
  createdBy: "me",
});

describe("unsynced local-id handling", () => {
  let storage: InMemoryStorageAdapter;
  let auth: InMemoryAuthAdapter;

  beforeEach(() => {
    storage = new InMemoryStorageAdapter();
    storage.initialize();
    auth = new InMemoryAuthAdapter();
    mockFetch.mockReset();
  });

  describe("permanent-vs-deferred classification", () => {
    it("does NOT mark a workout create permanent when a nested exerciseId is still local", async () => {
      // The shipped bug: the deferral guard only checked four TOP-LEVEL keys, so
      // `exercises[].exerciseId` was invisible and the 400 was treated as
      // permanent — losing the workout even though the reference resolves as soon
      // as the exercise create flushes.
      storage.enqueueMutation({
        entityType: "workout",
        entityId: "local-w1",
        operation: "create",
        payload: {
          name: "Push",
          exercises: [{ exerciseId: "local-ex-1", sortOrder: 0 }],
        },
        endpoint: "/workouts",
        method: "POST",
      });
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => '{"detail":"Invalid identifier format"}',
      });

      await processSyncQueue(storage, auth, "https://api.test");

      // Retryable, not terminal.
      const pending = storage.getPendingMutations();
      expect(pending).toHaveLength(1);
      expect(pending[0].status).toBe("failed");
    });

    it("DOES mark a workout create permanent when no local reference remains", async () => {
      // The counter-case, so the test above can actually fail: without a
      // `local-` reference a 400 is a genuine permanent client error.
      storage.enqueueMutation({
        entityType: "workout",
        entityId: "w1",
        operation: "create",
        payload: {
          name: "Push",
          exercises: [
            {
              exerciseId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
              sortOrder: 0,
            },
          ],
        },
        endpoint: "/workouts",
        method: "POST",
      });
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => '{"detail":"something genuinely wrong"}',
      });

      await processSyncQueue(storage, auth, "https://api.test");

      expect(storage.getPendingMutations()).toHaveLength(0);
      expect(storage.getFailedExhaustedEntries()[0].status).toBe(
        "permanently_failed",
      );
    });

    it("does NOT mark a DELETE permanent when the ENDPOINT carries a local id", async () => {
      // A DELETE has an empty payload, so a payload-only check could never see
      // this. `/workouts/local-…` 400s until the create flushes and
      // swapLocalWorkoutId rewrites the endpoint.
      storage.enqueueMutation({
        entityType: "workout",
        entityId: "local-w1",
        operation: "delete",
        payload: {},
        endpoint: "/workouts/local-w1",
        method: "DELETE",
      });
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => '{"detail":"Invalid identifier format"}',
      });

      await processSyncQueue(storage, auth, "https://api.test");

      const pending = storage.getPendingMutations();
      expect(pending).toHaveLength(1);
      expect(pending[0].status).toBe("failed");
    });

    it("still marks a DELETE against a real id permanent on 404", async () => {
      storage.enqueueMutation({
        entityType: "workout",
        entityId: "w1",
        operation: "delete",
        payload: {},
        endpoint: "/workouts/w1",
        method: "DELETE",
      });
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => '{"error":"not found"}',
      });

      await processSyncQueue(storage, auth, "https://api.test");

      expect(storage.getPendingMutations()).toHaveLength(0);
    });
  });

  describe("deleteExerciseCommand", () => {
    function apiThatMustNotBeCalled(): ApiPort {
      return {
        deleteExercise: jest.fn(() => {
          throw new Error("api.deleteExercise must not be called");
        }),
      } as unknown as ApiPort;
    }

    it("deletes locally and discards the queued create, without touching the API", async () => {
      storage.saveCustomExercise(localExercise("local-ex-1"));
      storage.enqueueMutation({
        entityType: "exercise",
        entityId: "local-ex-1",
        operation: "create",
        payload: { name: "My Lift" },
        endpoint: "/exercises",
        method: "POST",
      });

      const api = apiThatMustNotBeCalled();
      const result = await deleteExerciseCommand(
        { api, storage },
        "local-ex-1",
      );

      expect(result.ok).toBe(true);
      expect(storage.getCachedExercise("local-ex-1")).toBeNull();
      // The create must be gone, or it would flush later and resurrect the row.
      expect(
        storage.getQueuedEntriesForEntity("exercise", "local-ex-1"),
      ).toEqual([]);
      expect(api.deleteExercise).not.toHaveBeenCalled();
    });

    it("discards a create that has already gone permanently_failed", async () => {
      // Where every custom exercise ended up under the enum→uuid 422. The row is
      // still local-only, so the delete must stay local.
      storage.saveCustomExercise(localExercise("local-ex-2"));
      storage.enqueueMutation({
        entityType: "exercise",
        entityId: "local-ex-2",
        operation: "create",
        payload: { name: "My Lift" },
        endpoint: "/exercises",
        method: "POST",
      });
      const [entry] = storage.getQueuedEntriesForEntity(
        "exercise",
        "local-ex-2",
      );
      storage.markMutationPermanentlyFailed(entry.id, "422");

      const api = apiThatMustNotBeCalled();
      const result = await deleteExerciseCommand(
        { api, storage },
        "local-ex-2",
      );

      expect(result.ok).toBe(true);
      expect(storage.getCachedExercise("local-ex-2")).toBeNull();
      expect(api.deleteExercise).not.toHaveBeenCalled();
    });

    it("goes through the API for an exercise with no outstanding create", async () => {
      storage.saveCustomExercise(localExercise("server-ex-1"));
      const api = {
        deleteExercise: jest.fn(async () => ok(undefined)),
      } as unknown as ApiPort;

      const result = await deleteExerciseCommand(
        { api, storage },
        "server-ex-1",
      );

      expect(result.ok).toBe(true);
      expect(api.deleteExercise).toHaveBeenCalledWith("server-ex-1");
      expect(storage.getCachedExercise("server-ex-1")).toBeNull();
    });

    it("goes through the API when the create has already COMPLETED", async () => {
      // A completed create means the server has the row; the local id may simply
      // not have been swapped yet. Deleting locally only would orphan it.
      storage.saveCustomExercise(localExercise("local-ex-3"));
      storage.enqueueMutation({
        entityType: "exercise",
        entityId: "local-ex-3",
        operation: "create",
        payload: { name: "My Lift" },
        endpoint: "/exercises",
        method: "POST",
      });
      const [entry] = storage.getQueuedEntriesForEntity(
        "exercise",
        "local-ex-3",
      );
      storage.markMutationCompleted(entry.id);

      const api = {
        deleteExercise: jest.fn(async () => ok(undefined)),
      } as unknown as ApiPort;
      await deleteExerciseCommand({ api, storage }, "local-ex-3");

      expect(api.deleteExercise).toHaveBeenCalledWith("local-ex-3");
    });
  });

  describe("updateExerciseCommand coalescing", () => {
    it("folds an edit into a permanently_failed create and re-queues it", async () => {
      // Previously the coalesce read `getPendingMutations()`, missed the terminal
      // entry, and enqueued `PATCH /exercises/local-…` — a second dead entry.
      const existing = localExercise("local-ex-9");
      storage.saveCustomExercise(existing);
      storage.enqueueMutation({
        entityType: "exercise",
        entityId: "local-ex-9",
        operation: "create",
        payload: { name: "Old name" },
        endpoint: "/exercises",
        method: "POST",
      });
      const [created] = storage.getQueuedEntriesForEntity(
        "exercise",
        "local-ex-9",
      );
      storage.markMutationPermanentlyFailed(created.id, "422");

      const result = updateExerciseCommand({ storage }, existing, {
        name: "New name",
        category: "strength",
        difficulty: "intermediate",
        primaryMuscleGroups: ["chest"],
        equipment: ["barbell"],
      });

      expect(result.ok).toBe(true);
      const queued = storage.getQueuedEntriesForEntity(
        "exercise",
        "local-ex-9",
      );
      // Exactly one entry, still the CREATE, carrying the edited payload, and
      // retryable again.
      expect(queued).toHaveLength(1);
      expect(queued[0].operation).toBe("create");
      expect(queued[0].status).toBe("pending");
      expect(JSON.parse(queued[0].payload).name).toBe("New name");
    });
  });
});
