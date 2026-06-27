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

  it("gates fuel when the target is null or non-positive", () => {
    expect(buildRings(0, 10000, 0, 20000, null).fuel).toBe("gated");
    expect(buildRings(0, 10000, 0, 20000, { consumed: 500, target: 0 }).fuel).toBe(
      "gated",
    );
  });

  it("makes fuel live with a target and folds it into todayPct", () => {
    const rings = buildRings(7420, 10000, 8400, 20000, {
      consumed: 1500,
      target: 2000,
    });
    expect(rings.fuel).toEqual({
      current: 1500,
      target: 2000,
      pct: 0.75,
      unit: "kcal",
    });
    // average of move(0.742) + train(0.42) + fuel(0.75) = 0.637333 → 64
    expect(rings.todayPct).toBe(64);
  });
});
