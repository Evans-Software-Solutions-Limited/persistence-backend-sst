import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import { logMeasurementCommand } from "../log-measurement.command";

describe("logMeasurementCommand", () => {
  let storage: InMemoryStorageAdapter;
  const deps = () => ({ storage, userId: "u1", day: "2026-06-10" });

  beforeEach(() => {
    storage = new InMemoryStorageAdapter();
  });

  it("rejects a weigh-in with no weight and no body-fat", () => {
    const res = logMeasurementCommand(deps(), {});
    expect(res.ok).toBe(false);
  });

  it("rejects an unrealistic weight", () => {
    expect(logMeasurementCommand(deps(), { weightKg: 0 }).ok).toBe(false);
    expect(logMeasurementCommand(deps(), { weightKg: 1000 }).ok).toBe(false);
  });

  it("optimistically appends to body-trend + enqueues a POST", () => {
    storage.cacheHome("u1", {} as never);
    const res = logMeasurementCommand(deps(), {
      weightKg: 82.5,
      bodyFatPercentage: 15,
      notes: "morning",
    });
    expect(res.ok).toBe(true);

    const trend = storage.getCachedBodyTrend("u1");
    expect(trend).toEqual([
      { date: "2026-06-10", weightKg: 82.5, bodyFat: 15 },
    ]);

    const queued = storage.getPendingMutations();
    expect(queued[0].endpoint).toBe("/measurements");
    expect(queued[0].method).toBe("POST");
    expect(storage.getCachedHome("u1")).toBeNull();
  });

  it("replaces a same-day point rather than duplicating", () => {
    storage.cacheBodyTrend("u1", [
      { date: "2026-06-10", weightKg: 80, bodyFat: null },
      { date: "2026-06-09", weightKg: 81, bodyFat: null },
    ]);
    logMeasurementCommand(deps(), { weightKg: 82.5 });
    const trend = storage.getCachedBodyTrend("u1");
    expect(trend).toHaveLength(2);
    expect(trend.find((p) => p.date === "2026-06-10")?.weightKg).toBe(82.5);
  });

  it("a body-fat-only weigh-in preserves the same-day weight (no wipe)", () => {
    storage.cacheBodyTrend("u1", [
      { date: "2026-06-10", weightKg: 80, bodyFat: 17.5 },
    ]);
    // Body-fat only — must NOT null out the existing 80 kg reading.
    logMeasurementCommand(deps(), { bodyFatPercentage: 18 });
    const point = storage
      .getCachedBodyTrend("u1")
      .find((p) => p.date === "2026-06-10");
    expect(point).toEqual({ date: "2026-06-10", weightKg: 80, bodyFat: 18 });
  });

  it("a weight-only weigh-in preserves the same-day body-fat (no wipe)", () => {
    storage.cacheBodyTrend("u1", [
      { date: "2026-06-10", weightKg: 80, bodyFat: 17.5 },
    ]);
    logMeasurementCommand(deps(), { weightKg: 81 });
    const point = storage
      .getCachedBodyTrend("u1")
      .find((p) => p.date === "2026-06-10");
    expect(point).toEqual({ date: "2026-06-10", weightKg: 81, bodyFat: 17.5 });
  });
});
