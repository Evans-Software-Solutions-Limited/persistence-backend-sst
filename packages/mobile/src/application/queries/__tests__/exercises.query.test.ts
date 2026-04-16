import {
  EXERCISE_CACHE_STALE_AFTER_MS,
  getExerciseQuery,
  getExercisesQuery,
  refreshExerciseCache,
} from "../exercises.query";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
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

describe("getExercisesQuery", () => {
  let storage: InMemoryStorageAdapter;

  beforeEach(() => {
    storage = new InMemoryStorageAdapter();
    storage.initialize();
  });

  it("returns empty result and isStale=true when cache is empty", () => {
    const result = getExercisesQuery(storage);
    expect(result.exercises).toEqual([]);
    expect(result.cacheAge).toBeNull();
    expect(result.isStale).toBe(true);
  });

  it("returns cached exercises with cacheAge and isStale=false when fresh", () => {
    const now = Date.parse("2026-04-16T12:00:00Z");
    storage.cacheExercises([buildExercise({ id: "e1", name: "Bench Press" })]);

    // Cache was just written; five minutes later is well within 24h
    const result = getExercisesQuery(
      storage,
      undefined,
      () => now + 5 * 60_000,
    );
    expect(result.exercises).toHaveLength(1);
    expect(result.cacheAge).not.toBeNull();
    expect(result.isStale).toBe(false);
  });

  it("marks cache as stale after 24h", () => {
    storage.cacheExercises([buildExercise({ id: "e1" })]);
    const cacheAgeMs = Date.parse(storage.getExerciseCacheAge() as string);

    const result = getExercisesQuery(
      storage,
      undefined,
      () => cacheAgeMs + EXERCISE_CACHE_STALE_AFTER_MS + 1,
    );
    expect(result.isStale).toBe(true);
  });

  it("applies filters to the cached result", () => {
    storage.cacheExercises([
      buildExercise({ id: "e1", name: "Bench Press" }),
      buildExercise({
        id: "e2",
        name: "Back Squat",
        primaryMuscleGroups: ["quadriceps"],
      }),
    ]);

    const result = getExercisesQuery(storage, { search: "bench" });
    expect(result.exercises).toHaveLength(1);
    expect(result.exercises[0].id).toBe("e1");
  });
});

describe("getExerciseQuery", () => {
  let api: InMemoryApiAdapter;
  let storage: InMemoryStorageAdapter;

  beforeEach(() => {
    api = new InMemoryApiAdapter();
    storage = new InMemoryStorageAdapter();
    storage.initialize();
  });

  it("returns the cached exercise without calling the API", async () => {
    storage.cacheExercises([buildExercise({ id: "e1", name: "Cached" })]);
    const spy = jest.spyOn(api, "getExercise");

    const result = await getExerciseQuery(api, storage, "e1");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.name).toBe("Cached");
    expect(spy).not.toHaveBeenCalled();
  });

  it("fetches from API and caches when not in local cache", async () => {
    api.exercises.push(buildExercise({ id: "e1", name: "From API" }));

    const result = await getExerciseQuery(api, storage, "e1");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.name).toBe("From API");

    // Now in cache
    expect(storage.getCachedExercise("e1")?.name).toBe("From API");
  });

  it("returns API error when exercise is missing in both cache and API", async () => {
    const result = await getExerciseQuery(api, storage, "missing");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("not_found");
  });
});

describe("refreshExerciseCache", () => {
  let api: InMemoryApiAdapter;
  let storage: InMemoryStorageAdapter;

  beforeEach(() => {
    api = new InMemoryApiAdapter();
    storage = new InMemoryStorageAdapter();
    storage.initialize();
  });

  it("populates the cache and records last-synced timestamp on success", async () => {
    api.exercises.push(buildExercise({ id: "e1" }));
    api.exercises.push(buildExercise({ id: "e2", name: "Squat" }));

    const result = await refreshExerciseCache(api, storage);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(2);

    expect(storage.getCachedExercises()).toHaveLength(2);
    expect(storage.getLastSyncedAt("exercises")).not.toBeNull();
  });

  it("forwards filters to the API", async () => {
    const spy = jest.spyOn(api, "getExercises");
    await refreshExerciseCache(api, storage, { search: "bench" });
    expect(spy).toHaveBeenCalledWith({ search: "bench" });
  });

  it("leaves the cache untouched on API failure", async () => {
    storage.cacheExercises([buildExercise({ id: "existing" })]);
    api.shouldFail = true;

    const result = await refreshExerciseCache(api, storage);
    expect(result.ok).toBe(false);
    expect(storage.getCachedExercise("existing")).not.toBeNull();
    expect(storage.getLastSyncedAt("exercises")).toBeNull();
  });
});
