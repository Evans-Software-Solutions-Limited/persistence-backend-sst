import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the engine so we can exercise the wrapper's success + error branches
// without a DB. Constructing StreakRepository / dispatcher is side-effect-free.
vi.mock("../engine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../engine")>();
  return { ...actual, evaluateStreaks: vi.fn() };
});
const ensureWorkoutStreak = vi.hoisted(() =>
  vi.fn(async (userId: string, ts: Date) => {
    void userId;
    void ts;
  }),
);
const reconcileWorkoutStreakHistory = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("../../repositories/streakRepository", () => ({
  StreakRepository: vi.fn().mockImplementation(() => ({
    ensureWorkoutStreak,
    reconcileWorkoutStreakHistory,
  })),
}));

import { evaluateStreaks } from "../engine";
import {
  safeEvaluateStreaks,
  safeReconcileWorkoutStreak,
  resolveEventTs,
} from "../evaluate";

const TS = new Date("2026-06-07T12:00:00Z");

describe("resolveEventTs", () => {
  const now = new Date("2026-06-10T12:00:00Z");

  it("keeps a valid past timestamp", () => {
    expect(resolveEventTs("2026-06-09T08:00:00Z", now).toISOString()).toBe(
      "2026-06-09T08:00:00.000Z",
    );
  });
  it("clamps a future timestamp to now", () => {
    expect(resolveEventTs("2026-06-21T00:00:00Z", now)).toBe(now);
  });
  it("falls back to now for a malformed string", () => {
    expect(resolveEventTs("not-a-date", now)).toBe(now);
  });
  it("falls back to now for a non-string (undefined / null)", () => {
    expect(resolveEventTs(undefined, now)).toBe(now);
    expect(resolveEventTs(null, now)).toBe(now);
  });
});

describe("safeEvaluateStreaks", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the engine result on success", async () => {
    const result = { advanced: [{ id: "s1" }], milestones: [] } as never;
    (evaluateStreaks as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      result,
    );
    const out = await safeEvaluateStreaks("u1", "workout_logged", TS);
    expect(out).toBe(result);
    expect(ensureWorkoutStreak).toHaveBeenCalledWith("u1", TS);
    expect(evaluateStreaks).toHaveBeenCalledWith(
      "u1",
      "workout_logged",
      TS,
      expect.objectContaining({
        data: expect.anything(),
        notifier: expect.anything(),
      }),
      { localDate: undefined },
    );
  });

  it("forwards an authoritative localDate to the engine for date-only events", async () => {
    (evaluateStreaks as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      advanced: [],
      milestones: [],
    } as never);
    await safeEvaluateStreaks("u1", "habit_completed", TS, "2026-06-04");
    expect(ensureWorkoutStreak).not.toHaveBeenCalled();
    expect(evaluateStreaks).toHaveBeenCalledWith(
      "u1",
      "habit_completed",
      TS,
      expect.anything(),
      { localDate: "2026-06-04" },
    );
  });

  it("swallows engine errors and returns an empty result", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    (evaluateStreaks as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("db down"),
    );
    const out = await safeEvaluateStreaks("u1", "habit_completed", TS);
    expect(out).toEqual({ advanced: [], milestones: [] });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("safeReconcileWorkoutStreak", () => {
  beforeEach(() => vi.clearAllMocks());

  it("atomically reconciles the workout streak history", async () => {
    await safeReconcileWorkoutStreak("u1");
    expect(reconcileWorkoutStreakHistory).toHaveBeenCalledWith("u1");
    expect(evaluateStreaks).not.toHaveBeenCalled();
  });

  it("does not fail an achievements read when reconciliation fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    reconcileWorkoutStreakHistory.mockRejectedValueOnce(new Error("db down"));
    await expect(safeReconcileWorkoutStreak("u1")).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
