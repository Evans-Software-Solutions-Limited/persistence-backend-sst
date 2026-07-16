import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import { logSleepCommand } from "../log-sleep.command";

describe("logSleepCommand", () => {
  let storage: InMemoryStorageAdapter;
  const deps = () => ({ storage, userId: "u1" });

  beforeEach(() => {
    storage = new InMemoryStorageAdapter();
  });

  it("rejects a zero duration", () => {
    const res = logSleepCommand(deps(), {
      sleepDate: "2026-07-16",
      durationMinutes: 0,
    });
    expect(res.ok).toBe(false);
  });

  it("rejects a duration over 1440 minutes", () => {
    const res = logSleepCommand(deps(), {
      sleepDate: "2026-07-16",
      durationMinutes: 1441,
    });
    expect(res.ok).toBe(false);
  });

  it("rejects a non-finite duration", () => {
    const res = logSleepCommand(deps(), {
      sleepDate: "2026-07-16",
      durationMinutes: NaN,
    });
    expect(res.ok).toBe(false);
  });

  it("enqueues a POST + invalidates home", () => {
    storage.cacheHome("u1", {} as never);
    const res = logSleepCommand(deps(), {
      sleepDate: "2026-07-16",
      durationMinutes: 450,
      sleepStart: "2026-07-15T23:30:00.000Z",
      sleepEnd: "2026-07-16T07:00:00.000Z",
    });
    expect(res.ok).toBe(true);

    const queued = storage.getPendingMutations();
    expect(queued).toHaveLength(1);
    expect(queued[0].entityType).toBe("sleep");
    expect(queued[0].entityId).toBe("2026-07-16");
    expect(queued[0].endpoint).toBe("/health/sleep");
    expect(queued[0].method).toBe("POST");
    expect(JSON.parse(queued[0].payload)).toEqual({
      sleepDate: "2026-07-16",
      durationMinutes: 450,
      sleepStart: "2026-07-15T23:30:00.000Z",
      sleepEnd: "2026-07-16T07:00:00.000Z",
    });

    expect(storage.getCachedHome("u1")).toBeNull();
  });

  it("re-saving the same day enqueues independently (idempotent day-keyed upsert)", () => {
    logSleepCommand(deps(), { sleepDate: "2026-07-16", durationMinutes: 300 });
    logSleepCommand(deps(), { sleepDate: "2026-07-16", durationMinutes: 480 });
    // Both saves enqueue independently (the sync worker's idempotent
    // day-keyed upsert makes replaying either one safe on reconnect — the
    // backend overwrites rather than duplicating).
    const queued = storage.getPendingMutations();
    expect(queued).toHaveLength(2);
    expect(JSON.parse(queued[1].payload)).toMatchObject({
      durationMinutes: 480,
    });
  });

  it("enqueues the payload without sleepStart/sleepEnd when not provided", () => {
    logSleepCommand(deps(), { sleepDate: "2026-07-16", durationMinutes: 300 });
    const queued = storage.getPendingMutations();
    const payload = JSON.parse(queued[0].payload) as {
      sleepStart?: string;
      sleepEnd?: string;
    };
    expect(payload.sleepStart).toBeUndefined();
    expect(payload.sleepEnd).toBeUndefined();
  });
});
