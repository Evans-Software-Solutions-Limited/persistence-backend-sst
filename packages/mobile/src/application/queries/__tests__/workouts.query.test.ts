import {
  getWorkoutsQuery,
  refreshWorkouts,
  refreshAllWorkouts,
} from "../workouts.query";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import type { Workout } from "@/domain/models/workout";

const buildWorkout = (overrides: Partial<Workout> = {}): Workout => ({
  id: overrides.id ?? "w-1",
  name: overrides.name ?? "Push",
  description: null,
  createdBy: overrides.createdBy ?? "test-user",
  visibility: overrides.visibility ?? "private",
  estimatedDurationMinutes: 45,
  showInOwnerLibrary: overrides.showInOwnerLibrary ?? true,
  exercises: overrides.exercises ?? [],
  createdAt: "2026-04-28T00:00:00Z",
  updatedAt: "2026-04-28T00:00:00Z",
  ...overrides,
});

describe("getWorkoutsQuery", () => {
  let storage: InMemoryStorageAdapter;

  beforeEach(() => {
    storage = new InMemoryStorageAdapter();
  });

  it("returns empty/stale slices when nothing cached", () => {
    const result = getWorkoutsQuery(storage, "user-1");
    expect(result.mine.workouts).toEqual([]);
    expect(result.mine.cached).toBeNull();
    expect(result.mine.isStale).toBe(true);
    expect(result.assigned.isStale).toBe(true);
    expect(result.default.isStale).toBe(true);
  });

  it("returns cached workouts and quota for `mine`", () => {
    storage.cacheWorkoutsList("user-1", "mine", [buildWorkout()], {
      used: 1,
      limit: 10,
    });
    const result = getWorkoutsQuery(storage, "user-1");
    expect(result.mine.workouts).toHaveLength(1);
    expect(result.mine.quota).toEqual({ used: 1, limit: 10 });
    expect(result.mine.isStale).toBe(false);
  });

  it("flags slice as stale when older than the TTL", () => {
    storage.cacheWorkoutsList("user-1", "mine", [], null);
    // Simulate the cache being old by passing a `now` six minutes in the future.
    const result = getWorkoutsQuery(
      storage,
      "user-1",
      () => Date.now() + 6 * 60 * 1000,
    );
    expect(result.mine.isStale).toBe(true);
  });

  it("isolates slices across users", () => {
    storage.cacheWorkoutsList(
      "user-1",
      "mine",
      [buildWorkout({ id: "A" })],
      null,
    );
    storage.cacheWorkoutsList(
      "user-2",
      "mine",
      [buildWorkout({ id: "B" })],
      null,
    );

    const r1 = getWorkoutsQuery(storage, "user-1");
    const r2 = getWorkoutsQuery(storage, "user-2");
    expect(r1.mine.workouts[0].id).toBe("A");
    expect(r2.mine.workouts[0].id).toBe("B");
  });
});

describe("refreshWorkouts", () => {
  it("fetches the slice and writes through to the cache", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    api.workouts.push(buildWorkout({ id: "w-1" }));
    api.workoutQuota = { used: 1, limit: 50 };

    const result = await refreshWorkouts(api, storage, "user-1", "mine");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.workouts).toHaveLength(1);
    expect(result.value.quota).toEqual({ used: 1, limit: 50 });

    // Verify cache write
    const cached = storage.getCachedWorkoutsList("user-1", "mine");
    expect(cached?.workouts[0].id).toBe("w-1");
    // Verify detail splatter
    expect(storage.getCachedWorkoutDetail("user-1", "w-1")?.workout.id).toBe(
      "w-1",
    );
  });

  it("propagates an api error without writing to cache", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    api.shouldFail = true;

    const result = await refreshWorkouts(api, storage, "user-1", "mine");
    expect(result.ok).toBe(false);
    expect(storage.getCachedWorkoutsList("user-1", "mine")).toBeNull();
  });
});

describe("refreshAllWorkouts", () => {
  it("fans out three parallel refreshes and reports each result", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();

    const result = await refreshAllWorkouts(api, storage, "user-1");
    expect(result.mine.ok).toBe(true);
    expect(result.assigned.ok).toBe(true);
    expect(result.default.ok).toBe(true);
  });

  it("does not block other sections when one fails (in this fake, all share shouldFail — sanity check shape)", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    api.shouldFail = true;

    const result = await refreshAllWorkouts(api, storage, "user-1");
    expect(result.mine.ok).toBe(false);
    expect(result.assigned.ok).toBe(false);
    expect(result.default.ok).toBe(false);
  });
});
