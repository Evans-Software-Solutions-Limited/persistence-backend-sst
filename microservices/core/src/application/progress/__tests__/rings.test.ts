import { describe, it, expect } from "vitest";
import { ratio, buildRings } from "../rings";

describe("ratio", () => {
  it("clamps to [0,1] and guards a non-positive target", () => {
    expect(ratio(5000, 10000)).toBe(0.5);
    expect(ratio(15000, 10000)).toBe(1);
    expect(ratio(-1, 10)).toBe(0);
    expect(ratio(5, 0)).toBe(0);
  });
});

describe("buildRings", () => {
  it("composes move + train, gates fuel, averages todayPct", () => {
    const rings = buildRings(7420, 10000, 8400, 20000);
    expect(rings.move).toEqual({
      current: 7420,
      target: 10000,
      pct: 0.742,
      unit: "steps",
    });
    expect(rings.train).toEqual({
      current: 8400,
      target: 20000,
      pct: 0.42,
      unit: "kg",
    });
    expect(rings.fuel).toBe("gated");
    // average of move(0.742) + train(0.42) = 0.581 → 58
    expect(rings.todayPct).toBe(58);
  });
});
