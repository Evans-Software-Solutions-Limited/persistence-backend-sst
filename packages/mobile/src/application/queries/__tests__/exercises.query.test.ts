import {
  EXERCISE_CACHE_STALE_AFTER_MS,
  REFRESH_MAX_PAGES,
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
    expect(result.lastSyncedAt).toBeNull();
    expect(result.isStale).toBe(true);
  });

  it("returns cached exercises with lastSyncedAt and isStale=false after a full refresh", () => {
    const syncedAt = "2026-04-16T12:00:00.000Z";
    storage.cacheExercises([buildExercise({ id: "e1", name: "Bench Press" })]);
    storage.setLastSyncedAt("exercises", syncedAt);

    // Five minutes later is well within 24h
    const result = getExercisesQuery(
      storage,
      undefined,
      () => Date.parse(syncedAt) + 5 * 60_000,
    );
    expect(result.exercises).toHaveLength(1);
    expect(result.lastSyncedAt).toBe(syncedAt);
    expect(result.isStale).toBe(false);
  });

  it("marks cache as stale 24h after the last completed refresh", () => {
    const syncedAt = "2026-04-16T12:00:00.000Z";
    storage.cacheExercises([buildExercise({ id: "e1" })]);
    storage.setLastSyncedAt("exercises", syncedAt);

    const result = getExercisesQuery(
      storage,
      undefined,
      () => Date.parse(syncedAt) + EXERCISE_CACHE_STALE_AFTER_MS + 1,
    );
    expect(result.isStale).toBe(true);
  });

  it("is stale when rows are cached but no full refresh has ever completed", () => {
    // Simulates a progressively-cached library from a truncated or failed
    // refresh: rows exist with fresh per-row syncedAt timestamps, but
    // last_synced_at is null because no full walk has succeeded. The UI
    // must keep attempting to refresh — NOT silently sit on a partial
    // library for 24h.
    storage.cacheExercises([buildExercise({ id: "partial" })]);
    expect(storage.getLastSyncedAt("exercises")).toBeNull();
    expect(storage.getExerciseCacheAge()).not.toBeNull();

    const result = getExercisesQuery(storage);
    expect(result.exercises).toHaveLength(1);
    expect(result.lastSyncedAt).toBeNull();
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

  it("forwards filters to the API (first page cursor=undefined)", async () => {
    const spy = jest.spyOn(api, "getExercises");
    await refreshExerciseCache(api, storage, { search: "bench" });
    expect(spy).toHaveBeenCalledWith({ search: "bench" }, undefined);
  });

  it("leaves the cache untouched on API failure", async () => {
    storage.cacheExercises([buildExercise({ id: "existing" })]);
    api.shouldFail = true;

    const result = await refreshExerciseCache(api, storage);
    expect(result.ok).toBe(false);
    expect(storage.getCachedExercise("existing")).not.toBeNull();
    expect(storage.getLastSyncedAt("exercises")).toBeNull();
  });

  it("walks paginated pages until hasMore is false", async () => {
    // Override the in-memory adapter's single-page behaviour with a stub
    // that returns two pages. The second page carries hasMore=false to stop
    // the loop — the function must keep calling until this condition.
    const spy = jest
      .spyOn(api, "getExercises")
      .mockImplementationOnce(async () => ({
        ok: true,
        value: {
          data: [buildExercise({ id: "e1", name: "Page1-A" })],
          cursor: "cursor-2",
          hasMore: true,
        },
      }))
      .mockImplementationOnce(async () => ({
        ok: true,
        value: {
          data: [buildExercise({ id: "e2", name: "Page2-A" })],
          cursor: null,
          hasMore: false,
        },
      }));

    const result = await refreshExerciseCache(api, storage);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.map((e) => e.id)).toEqual(["e1", "e2"]);
    }

    expect(spy).toHaveBeenNthCalledWith(1, undefined, undefined);
    expect(spy).toHaveBeenNthCalledWith(2, undefined, "cursor-2");
    expect(storage.getCachedExercises()).toHaveLength(2);
  });

  it("stops walking when the cursor is missing even if hasMore=true", async () => {
    // Defensive: if the backend mis-reports hasMore but stops sending a
    // cursor, the loop must still terminate rather than spin forever.
    jest.spyOn(api, "getExercises").mockImplementationOnce(async () => ({
      ok: true,
      value: {
        data: [buildExercise({ id: "e1" })],
        cursor: null,
        hasMore: true,
      },
    }));

    const result = await refreshExerciseCache(api, storage);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(1);
  });

  it("surfaces API errors raised partway through pagination", async () => {
    jest
      .spyOn(api, "getExercises")
      .mockImplementationOnce(async () => ({
        ok: true,
        value: {
          data: [buildExercise({ id: "e1" })],
          cursor: "cursor-2",
          hasMore: true,
        },
      }))
      .mockImplementationOnce(async () => ({
        ok: false,
        error: { kind: "api", code: "network", message: "boom" },
      }));

    const result = await refreshExerciseCache(api, storage);
    expect(result.ok).toBe(false);

    // First page was cached before the failure (progressive caching).
    // last_synced_at is only set once a full walk succeeds.
    expect(storage.getCachedExercise("e1")).not.toBeNull();
    expect(storage.getLastSyncedAt("exercises")).toBeNull();
  });

  it("does not mark sync complete when walk is truncated at REFRESH_MAX_PAGES", async () => {
    // Simulate a backend that always says "more data" — the walker should
    // hit REFRESH_MAX_PAGES and return a server error rather than silently
    // marking a partial refresh as fully synced. Otherwise isStale would
    // return false for 24h and the UI would never re-attempt the fetch.
    const spy = jest
      .spyOn(api, "getExercises")
      .mockImplementation(async (_filters, cursor) => ({
        ok: true,
        value: {
          data: [buildExercise({ id: `page-${cursor ?? "start"}` })],
          cursor: `cursor-${(cursor ?? "0") + "-next"}`,
          hasMore: true,
        },
      }));

    const result = await refreshExerciseCache(api, storage);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("server");
      expect(result.error.message).toContain("truncated");
    }

    // Exactly REFRESH_MAX_PAGES calls made
    expect(spy).toHaveBeenCalledTimes(REFRESH_MAX_PAGES);
    // Progressive caching still applied
    expect(storage.getCachedExercises().length).toBeGreaterThan(0);
    // Crucially: last_synced_at NOT set, so isStale will force another refresh
    expect(storage.getLastSyncedAt("exercises")).toBeNull();

    // End-to-end regression: a consumer calling getExercisesQuery
    // immediately after the truncated refresh MUST see isStale=true,
    // otherwise the 24h freshness window would suppress the next retry.
    const queryResult = getExercisesQuery(storage);
    expect(queryResult.isStale).toBe(true);
    expect(queryResult.lastSyncedAt).toBeNull();
  });
});
