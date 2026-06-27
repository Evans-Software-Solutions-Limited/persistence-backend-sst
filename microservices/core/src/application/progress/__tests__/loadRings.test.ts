import { describe, it, expect, vi } from "vitest";
import { loadRings } from "../loadRings";

const NOW = new Date("2026-06-10T12:00:00Z"); // Wed → week 06-08..06-14

describe("loadRings", () => {
  it("loads steps + current-week volume into the ring composition; Fuel gated with no target", async () => {
    const ports = {
      getUserTimezone: vi.fn(async () => "Europe/London"),
      totalVolume: vi.fn(async () => 8400),
      getTodaySteps: vi.fn(async () => 7420),
      sumKcalForDay: vi.fn(async () => 1200),
      getDailyKcalTarget: vi.fn(async () => null),
    };
    const rings = await loadRings(ports, "u1", NOW);

    expect(ports.totalVolume).toHaveBeenCalledWith(
      "u1",
      "Europe/London",
      "2026-06-08",
      "2026-06-14",
    );
    expect(ports.getTodaySteps).toHaveBeenCalledWith("u1", "2026-06-10");
    expect(ports.sumKcalForDay).toHaveBeenCalledWith("u1", "2026-06-10");
    expect(rings.move.current).toBe(7420);
    expect(rings.train.current).toBe(8400);
    // No daily kcal target set → Fuel stays gated even though kcal were logged.
    expect(rings.fuel).toBe("gated");
  });

  it("makes Fuel live when a daily kcal target is set", async () => {
    const ports = {
      getUserTimezone: vi.fn(async () => "Europe/London"),
      totalVolume: vi.fn(async () => 8400),
      getTodaySteps: vi.fn(async () => 7420),
      sumKcalForDay: vi.fn(async () => 1500),
      getDailyKcalTarget: vi.fn(async () => 2000),
    };
    const rings = await loadRings(ports, "u1", NOW);

    expect(rings.fuel).toEqual({
      current: 1500,
      target: 2000,
      pct: 0.75,
      unit: "kcal",
    });
  });
});
