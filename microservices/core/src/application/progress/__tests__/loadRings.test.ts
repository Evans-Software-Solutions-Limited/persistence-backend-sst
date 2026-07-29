import { describe, it, expect, vi } from "vitest";
import { loadRings, DEFAULT_GOAL_STEPS } from "../loadRings";

const NOW = new Date("2026-06-10T12:00:00Z"); // Wed

const makePorts = (over: Partial<Record<string, unknown>> = {}) => ({
  getUserTimezone: vi.fn(async () => "Europe/London"),
  getTodaySteps: vi.fn(async () => 7420),
  getTodayActiveKcal: vi.fn(async () => 371),
  getDailyStepsGoal: vi.fn(async (): Promise<number | null> => null),
  sumKcalForDay: vi.fn(async () => 1200),
  getDailyKcalTarget: vi.fn(async (): Promise<number | null> => null),
  ...over,
});

describe("loadRings", () => {
  it("reads every input for the user-local DAY; Fuel gated with no target", async () => {
    const ports = makePorts();
    const rings = await loadRings(ports, "u1", NOW);

    // All three rings are daily — each read is scoped to the local date, and
    // nothing asks for a week window any more.
    expect(ports.getTodaySteps).toHaveBeenCalledWith("u1", "2026-06-10");
    expect(ports.getTodayActiveKcal).toHaveBeenCalledWith("u1", "2026-06-10");
    expect(ports.sumKcalForDay).toHaveBeenCalledWith("u1", "2026-06-10");
    expect(rings.move.current).toBe(7420);
    expect(rings.train.current).toBe(371);
    expect(rings.train.unit).toBe("kcal");
    // No daily kcal target set → Fuel stays gated even though kcal were logged.
    expect(rings.fuel).toBe("gated");
  });

  it("uses the user's Steps habit target as the Move goal", async () => {
    const ports = makePorts({
      getDailyStepsGoal: vi.fn(async () => 8000),
      getTodaySteps: vi.fn(async () => 4000),
    });
    const rings = await loadRings(ports, "u1", NOW);

    expect(rings.move.target).toBe(8000);
    expect(rings.move.pct).toBe(0.5);
  });

  it("falls back to the default step goal when no habit is configured", async () => {
    const rings = await loadRings(makePorts(), "u1", NOW);
    expect(rings.move.target).toBe(DEFAULT_GOAL_STEPS);
  });

  it("ignores a non-positive habit target rather than zeroing the ring", async () => {
    const ports = makePorts({ getDailyStepsGoal: vi.fn(async () => 0) });
    const rings = await loadRings(ports, "u1", NOW);
    expect(rings.move.target).toBe(DEFAULT_GOAL_STEPS);
    expect(rings.move.pct).toBeGreaterThan(0);
  });

  it("makes Fuel live when a daily kcal target is set", async () => {
    const ports = makePorts({
      sumKcalForDay: vi.fn(async () => 1500),
      getDailyKcalTarget: vi.fn(async () => 2000),
    });
    const rings = await loadRings(ports, "u1", NOW);

    expect(rings.fuel).toEqual({
      current: 1500,
      target: 2000,
      pct: 0.75,
      unit: "kcal",
    });
  });
});
