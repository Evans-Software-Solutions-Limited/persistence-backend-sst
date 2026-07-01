import {
  clampFraction,
  fractionToValue,
  stepDecimalPlaces,
  valueToFraction,
} from "../math";

describe("clampFraction", () => {
  it("maps a mid-track touch to 0.5", () => {
    expect(clampFraction(50, 100)).toBe(0.5);
  });

  it("clamps below-track touches to 0", () => {
    expect(clampFraction(-20, 100)).toBe(0);
  });

  it("clamps beyond-track touches to 1", () => {
    expect(clampFraction(150, 100)).toBe(1);
  });

  it("returns 0 for a zero/negative width (not-yet-measured track)", () => {
    expect(clampFraction(50, 0)).toBe(0);
    expect(clampFraction(50, -10)).toBe(0);
  });
});

describe("valueToFraction", () => {
  it("maps the min to 0 and the max to 1", () => {
    expect(valueToFraction(-1, -1, 1)).toBe(0);
    expect(valueToFraction(1, -1, 1)).toBe(1);
  });

  it("maps the midpoint to 0.5", () => {
    expect(valueToFraction(0, -1, 1)).toBe(0.5);
  });

  it("clamps an out-of-range value into [0, 1]", () => {
    expect(valueToFraction(-5, -1, 1)).toBe(0);
    expect(valueToFraction(5, -1, 1)).toBe(1);
  });

  it("returns 0 when min === max (degenerate range)", () => {
    expect(valueToFraction(50, 10, 10)).toBe(0);
  });
});

describe("stepDecimalPlaces", () => {
  it.each([
    [1, 0],
    [0.05, 2],
    [0.1, 1],
    [10, 0],
  ])("step %p → %p decimal places", (step, expected) => {
    expect(stepDecimalPlaces(step)).toBe(expected);
  });
});

describe("fractionToValue", () => {
  it("rounds to the nearest integer step (macro slider: 0-100 step 1)", () => {
    expect(fractionToValue(0.334, 0, 100, 1)).toBe(33);
    expect(fractionToValue(0.336, 0, 100, 1)).toBe(34);
  });

  it("rounds to the nearest 0.05 step without float noise (goal slider: -1 to 1)", () => {
    // 0.6 fraction over [-1,1] = -1 + 0.6*2 = 0.2 exactly on a step boundary.
    expect(fractionToValue(0.6, -1, 1, 0.05)).toBe(0.2);
    // A fraction landing between steps snaps to the nearer one.
    expect(fractionToValue(0.61, -1, 1, 0.05)).toBeCloseTo(0.2, 5);
  });

  it("never returns a value outside [min, max] even from an out-of-range fraction", () => {
    expect(fractionToValue(-0.5, 0, 100, 1)).toBe(0);
    expect(fractionToValue(1.5, 0, 100, 1)).toBe(100);
  });

  it("passes the value through unrounded when step is 0 (no quantisation)", () => {
    expect(fractionToValue(0.3333, 0, 1, 0)).toBeCloseTo(0.3333, 5);
  });

  it("round-trips with valueToFraction for exact step-aligned values", () => {
    const value = 30;
    const fraction = valueToFraction(value, 0, 100);
    expect(fractionToValue(fraction, 0, 100, 1)).toBe(value);
  });
});
