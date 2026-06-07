import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the engine so we can exercise the wrapper's success + error branches
// without a DB. Constructing StreakRepository / dispatcher is side-effect-free.
vi.mock("../engine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../engine")>();
  return { ...actual, evaluateStreaks: vi.fn() };
});

import { evaluateStreaks } from "../engine";
import { safeEvaluateStreaks } from "../evaluate";

const TS = new Date("2026-06-07T12:00:00Z");

describe("safeEvaluateStreaks", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the engine result on success", async () => {
    const result = { advanced: [{ id: "s1" }], milestones: [] } as never;
    (evaluateStreaks as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      result,
    );
    const out = await safeEvaluateStreaks("u1", "workout_logged", TS);
    expect(out).toBe(result);
    expect(evaluateStreaks).toHaveBeenCalledWith(
      "u1",
      "workout_logged",
      TS,
      expect.objectContaining({
        data: expect.anything(),
        notifier: expect.anything(),
      }),
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
