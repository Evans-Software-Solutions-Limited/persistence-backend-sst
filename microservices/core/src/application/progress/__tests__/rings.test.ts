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
    const rings = buildRings({
      steps: 7420,
      goalSteps: 10000,
      activeKcal: 371,
      goalActiveKcal: 500,
    });
    expect(rings.move).toEqual({
      current: 7420,
      target: 10000,
      pct: 0.742,
      unit: "steps",
    });
    expect(rings.train).toEqual({
      current: 371,
      target: 500,
      pct: 0.742,
      unit: "kcal",
    });
    expect(rings.fuel).toBe("gated");
    // average of move(0.742) + train(0.742) = 0.742 → 74
    expect(rings.todayPct).toBe(74);
  });

  it("measures Train in DAILY active kcal, not weekly volume", () => {
    // The regression this replaces: 8960 kg lifted against a hardcoded 20 t
    // weekly target rendered 45% on a ring labelled "today". Train now reads
    // active energy, so a 560 kcal day against a 500 kcal goal CLOSES.
    const rings = buildRings({
      steps: 0,
      goalSteps: 10000,
      activeKcal: 560,
      goalActiveKcal: 500,
    });
    expect(rings.train.unit).toBe("kcal");
    expect(rings.train.current).toBe(560);
    expect(rings.train.pct).toBe(1);
  });

  it("honours a per-user step goal over the caller's default", () => {
    const rings = buildRings({
      steps: 4000,
      goalSteps: 8000,
      activeKcal: 0,
      goalActiveKcal: 500,
    });
    expect(rings.move.target).toBe(8000);
    expect(rings.move.pct).toBe(0.5);
  });

  it("gates fuel when the target is null, absent or non-positive", () => {
    const base = {
      steps: 0,
      goalSteps: 10000,
      activeKcal: 0,
      goalActiveKcal: 500,
    };
    expect(buildRings(base).fuel).toBe("gated");
    expect(buildRings({ ...base, fuel: null }).fuel).toBe("gated");
    expect(
      buildRings({ ...base, fuel: { consumed: 500, target: 0 } }).fuel,
    ).toBe("gated");
  });

  it("makes fuel live with a target and folds it into todayPct", () => {
    const rings = buildRings({
      steps: 7420,
      goalSteps: 10000,
      activeKcal: 210,
      goalActiveKcal: 500,
      fuel: { consumed: 1500, target: 2000 },
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
