import { describe, it, expect, vi } from "vitest";
import { loadRings } from "../loadRings";

const NOW = new Date("2026-06-10T12:00:00Z"); // Wed → week 06-08..06-14

describe("loadRings", () => {
  it("loads steps + current-week volume into the ring composition", async () => {
    const ports = {
      getUserTimezone: vi.fn(async () => "Europe/London"),
      totalVolume: vi.fn(async () => 8400),
      getTodaySteps: vi.fn(async () => 7420),
    };
    const rings = await loadRings(ports, "u1", NOW);

    expect(ports.totalVolume).toHaveBeenCalledWith(
      "u1",
      "Europe/London",
      "2026-06-08",
      "2026-06-14",
    );
    expect(ports.getTodaySteps).toHaveBeenCalledWith("u1", "2026-06-10");
    expect(rings.move.current).toBe(7420);
    expect(rings.train.current).toBe(8400);
    expect(rings.fuel).toBe("gated");
  });
});
