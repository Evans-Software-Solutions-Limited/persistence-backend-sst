import { createWorkoutCommand } from "../create-workout.command";
import { updateWorkoutCommand } from "../update-workout.command";
import { deleteWorkoutCommand } from "../delete-workout.command";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { Workout } from "@/domain/models/workout";

describe("createWorkoutCommand", () => {
  let storage: InMemoryStorageAdapter;
  let nextId = 0;
  const generateId = () => `id-${++nextId}`;

  beforeEach(() => {
    storage = new InMemoryStorageAdapter();
    nextId = 0;
  });

  it("validates input and short-circuits on failure (no cache write, no enqueue)", () => {
    const result = createWorkoutCommand(
      { storage, generateId, userId: "user-1" },
      { name: "", exercises: [] },
    );
    expect(result.ok).toBe(false);
    expect(storage.getPendingMutations()).toHaveLength(0);
    expect(storage.getCachedWorkoutsList("user-1", "mine")).toBeNull();
  });

  it("creates a local-prefixed workout, writes to cache, and enqueues a POST mutation", () => {
    const result = createWorkoutCommand(
      { storage, generateId, userId: "user-1" },
      {
        name: "  Push Day  ",
        exercises: [{ exerciseId: "ex-1", sortOrder: 0 }],
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.id.startsWith("local-")).toBe(true);
    // Trim from sanitize
    expect(result.value.name).toBe("Push Day");
    expect(result.value.createdBy).toBe("user-1");
    expect(result.value.visibility).toBe("private");
    expect(result.value.estimatedDurationMinutes).toBe(30);
    // Detail cache
    expect(
      storage.getCachedWorkoutDetail("user-1", result.value.id)?.workout.id,
    ).toBe(result.value.id);
    // List slice (mine)
    const mine = storage.getCachedWorkoutsList("user-1", "mine");
    expect(mine?.workouts[0].id).toBe(result.value.id);
    // Enqueued
    const pending = storage.getPendingMutations();
    expect(pending).toHaveLength(1);
    expect(pending[0].entityType).toBe("workout");
    expect(pending[0].operation).toBe("create");
    expect(pending[0].endpoint).toBe("/workouts");
    expect(pending[0].method).toBe("POST");
  });

  it("prepends the new workout to existing mine list", () => {
    const existing: Workout = {
      id: "wo-existing",
      name: "Old",
      description: null,
      createdBy: "user-1",
      visibility: "private",
      estimatedDurationMinutes: 30,
      exercises: [],
      createdAt: "2026-04-27T00:00:00Z",
      updatedAt: "2026-04-27T00:00:00Z",
    };
    storage.cacheWorkoutsList("user-1", "mine", [existing], null);

    const result = createWorkoutCommand(
      { storage, generateId, userId: "user-1" },
      { name: "New", exercises: [{ exerciseId: "ex-1", sortOrder: 0 }] },
    );
    expect(result.ok).toBe(true);
    const mine = storage.getCachedWorkoutsList("user-1", "mine");
    expect(mine?.workouts.map((w) => w.name)).toEqual(["New", "Old"]);
  });
});

describe("updateWorkoutCommand", () => {
  let storage: InMemoryStorageAdapter;
  let nextId = 0;
  const generateId = () => `id-${++nextId}`;

  beforeEach(() => {
    storage = new InMemoryStorageAdapter();
    nextId = 0;
    const existing: Workout = {
      id: "w-1",
      name: "Old Name",
      description: "old desc",
      createdBy: "user-1",
      visibility: "private",
      estimatedDurationMinutes: 30,
      exercises: [],
      createdAt: "2026-04-27T00:00:00Z",
      updatedAt: "2026-04-27T00:00:00Z",
    };
    storage.cacheWorkoutDetail("user-1", existing);
    storage.cacheWorkoutsList("user-1", "mine", [existing], null);
  });

  it("rejects empty name with a validation error and does not enqueue", () => {
    const result = updateWorkoutCommand(
      { storage, generateId, userId: "user-1" },
      "w-1",
      { name: "" },
    );
    expect(result.ok).toBe(false);
    expect(storage.getPendingMutations()).toHaveLength(0);
  });

  it("rejects targetRepsMin > targetRepsMax", () => {
    const result = updateWorkoutCommand(
      { storage, generateId, userId: "user-1" },
      "w-1",
      {
        exercises: [
          {
            exerciseId: "ex-1",
            sortOrder: 0,
            targetRepsMin: 12,
            targetRepsMax: 8,
          },
        ],
      },
    );
    expect(result.ok).toBe(false);
  });

  it("rejects when the workout isn't cached locally", () => {
    const result = updateWorkoutCommand(
      { storage, generateId, userId: "user-1" },
      "missing-id",
      { name: "X" },
    );
    expect(result.ok).toBe(false);
  });

  it("merges metadata into cached workout and enqueues PATCH", () => {
    const result = updateWorkoutCommand(
      { storage, generateId, userId: "user-1" },
      "w-1",
      { name: "  New Name  ", description: "  new desc  " },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.name).toBe("New Name");
    expect(result.value.description).toBe("new desc");

    expect(storage.getCachedWorkoutDetail("user-1", "w-1")?.workout.name).toBe(
      "New Name",
    );
    const pending = storage.getPendingMutations();
    expect(pending).toHaveLength(1);
    expect(pending[0].operation).toBe("update");
    expect(pending[0].method).toBe("PATCH");
    expect(pending[0].endpoint).toBe("/workouts/w-1");
  });

  it("full-replaces exercises when provided", () => {
    const result = updateWorkoutCommand(
      { storage, generateId, userId: "user-1" },
      "w-1",
      {
        exercises: [
          {
            exerciseId: "ex-2",
            sortOrder: 0,
            targetRepsMin: 5,
            targetRepsMax: 8,
          },
        ],
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.exercises).toHaveLength(1);
    expect(result.value.exercises[0].exerciseId).toBe("ex-2");
  });

  it("clears description when explicitly set to whitespace string", () => {
    const result = updateWorkoutCommand(
      { storage, generateId, userId: "user-1" },
      "w-1",
      { description: "   " },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.description).toBeNull();
  });
});

describe("deleteWorkoutCommand", () => {
  let storage: InMemoryStorageAdapter;

  beforeEach(() => {
    storage = new InMemoryStorageAdapter();
    const w: Workout = {
      id: "w-1",
      name: "Push",
      description: null,
      createdBy: "user-1",
      visibility: "private",
      estimatedDurationMinutes: 30,
      exercises: [],
      createdAt: "2026-04-27T00:00:00Z",
      updatedAt: "2026-04-27T00:00:00Z",
    };
    storage.cacheWorkoutDetail("user-1", w);
    storage.cacheWorkoutsList("user-1", "mine", [w], null);
  });

  it("removes from cache and enqueues DELETE", () => {
    const result = deleteWorkoutCommand({ storage, userId: "user-1" }, "w-1");
    expect(result.ok).toBe(true);
    expect(storage.getCachedWorkoutDetail("user-1", "w-1")).toBeNull();
    expect(
      storage.getCachedWorkoutsList("user-1", "mine")?.workouts,
    ).toHaveLength(0);
    const pending = storage.getPendingMutations();
    expect(pending).toHaveLength(1);
    expect(pending[0].operation).toBe("delete");
    expect(pending[0].method).toBe("DELETE");
  });
});
