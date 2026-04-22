import {
  getReferenceListQuery,
  refreshReferenceList,
} from "../reference-lists.query";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { ReferenceEntry } from "@/domain/models/reference-list";
import { REFERENCE_LIST_STALE_AFTER_MS } from "@/domain/models/reference-list";

const entry = (
  name: string,
  overrides: Partial<ReferenceEntry> = {},
): ReferenceEntry => ({
  id: `${name}-uuid`,
  name,
  displayName: name.charAt(0).toUpperCase() + name.slice(1),
  ...overrides,
});

describe("getReferenceListQuery", () => {
  let storage: InMemoryStorageAdapter;

  beforeEach(() => {
    storage = new InMemoryStorageAdapter();
  });

  it("returns empty + isStale=true when the cache is empty", () => {
    const result = getReferenceListQuery(storage, "muscle_groups");
    expect(result.entries).toEqual([]);
    expect(result.isStale).toBe(true);
    expect(result.cached).toBeNull();
  });

  it("returns cached entries with isStale=false when the cache is fresh", () => {
    storage.cacheReferenceList("muscle_groups", [
      entry("chest"),
      entry("back"),
    ]);

    const result = getReferenceListQuery(
      storage,
      "muscle_groups",
      () => Date.now(), // synced_at is ~now, well inside the 24h window
    );
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0].name).toBe("chest");
    expect(result.isStale).toBe(false);
  });

  it("flags the cache as stale after 24h", () => {
    storage.cacheReferenceList("muscle_groups", [entry("chest")]);

    // Fast-forward the clock past the staleness window.
    const now = Date.now() + REFERENCE_LIST_STALE_AFTER_MS + 1;
    const result = getReferenceListQuery(storage, "muscle_groups", () => now);
    expect(result.entries).toHaveLength(1);
    expect(result.isStale).toBe(true);
  });

  it("flags the cache as stale exactly at the staleness threshold", () => {
    storage.cacheReferenceList("muscle_groups", [entry("chest")]);

    const now = Date.now() + REFERENCE_LIST_STALE_AFTER_MS;
    const result = getReferenceListQuery(storage, "muscle_groups", () => now);
    expect(result.isStale).toBe(true);
  });

  it("treats each kind independently (muscle_groups vs equipment)", () => {
    storage.cacheReferenceList("muscle_groups", [entry("chest")]);

    const muscles = getReferenceListQuery(storage, "muscle_groups");
    const equipment = getReferenceListQuery(storage, "equipment");
    expect(muscles.entries).toHaveLength(1);
    expect(equipment.entries).toEqual([]);
    expect(equipment.cached).toBeNull();
  });
});

describe("refreshReferenceList", () => {
  let storage: InMemoryStorageAdapter;
  let api: InMemoryApiAdapter;

  beforeEach(() => {
    storage = new InMemoryStorageAdapter();
    api = new InMemoryApiAdapter();
  });

  it("fetches from the API and writes to the cache", async () => {
    api.referenceLists.muscle_groups = [entry("chest"), entry("back")];

    const result = await refreshReferenceList(api, storage, "muscle_groups");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(2);
    }

    // Cache now populated
    const cached = storage.getCachedReferenceList("muscle_groups");
    expect(cached?.entries).toHaveLength(2);
    expect(cached?.syncedAt).toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it("leaves the cache untouched when the API fails", async () => {
    storage.cacheReferenceList("muscle_groups", [entry("chest")]);
    api.shouldFail = true;

    const result = await refreshReferenceList(api, storage, "muscle_groups");
    expect(result.ok).toBe(false);

    // Cache preserved
    const cached = storage.getCachedReferenceList("muscle_groups");
    expect(cached?.entries).toHaveLength(1);
    expect(cached?.entries[0].name).toBe("chest");
  });

  it("overwrites existing cache when refresh succeeds", async () => {
    storage.cacheReferenceList("equipment", [entry("barbell")]);
    api.referenceLists.equipment = [
      entry("dumbbell"),
      entry("kettlebell"),
      entry("cable"),
    ];

    await refreshReferenceList(api, storage, "equipment");
    const cached = storage.getCachedReferenceList("equipment");
    expect(cached?.entries.map((e) => e.name)).toEqual([
      "dumbbell",
      "kettlebell",
      "cable",
    ]);
  });
});
