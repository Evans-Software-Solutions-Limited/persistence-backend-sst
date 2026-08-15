import { hydrateRecentSetsCommand } from "../hydrate-recent-sets.command";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { RecentSetEntry } from "@/domain/ports/storage.port";
import { ok, fail } from "@/shared/errors";

const USER = "user-1";

const serverSets: RecentSetEntry[] = [
  {
    exerciseId: "ex-bench",
    setNumber: 1,
    weightKg: 60,
    reps: 8,
    recordedAt: "2026-08-07T14:25:28.838Z",
  },
  {
    exerciseId: "ex-bench",
    setNumber: 2,
    weightKg: 62.5,
    reps: 6,
    recordedAt: "2026-08-07T14:25:28.838Z",
  },
];

describe("hydrateRecentSetsCommand", () => {
  it("hydrates the empty cache from the server", async () => {
    const storage = new InMemoryStorageAdapter();
    const getRecentSets = jest.fn().mockResolvedValue(ok(serverSets));

    const result = await hydrateRecentSetsCommand({
      storage,
      api: { getRecentSets },
      userId: USER,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ hydrated: 2, skipped: false });
    }
    // The hints are now readable for the next session.
    expect(storage.getRecentSetsByExercise(USER, ["ex-bench"])).toEqual({
      "ex-bench": {
        1: { weightKg: 60, reps: 8 },
        2: { weightKg: 62.5, reps: 6 },
      },
    });
  });

  it("skips (and does not fetch) when the cache already has entries", async () => {
    const storage = new InMemoryStorageAdapter();
    storage.upsertRecentSets(USER, [
      {
        exerciseId: "ex-squat",
        setNumber: 1,
        weightKg: 100,
        reps: 5,
        recordedAt: "2026-08-10T10:00:00.000Z",
      },
    ]);
    const getRecentSets = jest.fn().mockResolvedValue(ok(serverSets));

    const result = await hydrateRecentSetsCommand({
      storage,
      api: { getRecentSets },
      userId: USER,
    });

    expect(getRecentSets).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ hydrated: 0, skipped: true });
    // Existing local entry is untouched — not clobbered by server data.
    expect(storage.getRecentSetsByExercise(USER, ["ex-squat"])).toEqual({
      "ex-squat": { 1: { weightKg: 100, reps: 5 } },
    });
  });

  it("returns ok with zero when the server has no history", async () => {
    const storage = new InMemoryStorageAdapter();
    const getRecentSets = jest.fn().mockResolvedValue(ok([]));

    const result = await hydrateRecentSetsCommand({
      storage,
      api: { getRecentSets },
      userId: USER,
    });

    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.value).toEqual({ hydrated: 0, skipped: false });
    expect(storage.hasAnyRecentSets(USER)).toBe(false);
  });

  it("propagates a fetch failure and leaves the cache empty", async () => {
    const storage = new InMemoryStorageAdapter();
    const getRecentSets = jest
      .fn()
      .mockResolvedValue(
        fail({ kind: "api", code: "server", message: "boom" }),
      );

    const result = await hydrateRecentSetsCommand({
      storage,
      api: { getRecentSets },
      userId: USER,
    });

    expect(result.ok).toBe(false);
    expect(storage.hasAnyRecentSets(USER)).toBe(false);
  });
});
