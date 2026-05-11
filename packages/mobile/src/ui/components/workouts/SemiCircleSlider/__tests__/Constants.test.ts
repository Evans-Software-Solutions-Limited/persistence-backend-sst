/**
 * Pure-function tests for the polar/canvas math + arc string builder
 * the SemiCircleSlider relies on. The slider's React surface itself
 * is gesture/SVG-driven and exercised on device — these helpers are
 * the only piece worth asserting in Jest.
 */

import {
  arc,
  canvas2Polar,
  containedInSquare,
  polar2Canvas,
  type Vector,
} from "../Constants";

describe("polar2Canvas", () => {
  const center: Vector = { x: 100, y: 100 };

  it("maps 9 o'clock (theta=π) to (center.x - radius, center.y)", () => {
    const point = polar2Canvas({ theta: Math.PI, radius: 50 }, center);
    expect(point.x).toBeCloseTo(50, 5);
    expect(point.y).toBeCloseTo(100, 5);
  });

  it("maps 12 o'clock (theta=3π/2) to (center.x, center.y - radius) — top of canvas", () => {
    // SVG y-axis points DOWN, so 'top' is center.y - radius.
    const point = polar2Canvas(
      { theta: (3 * Math.PI) / 2, radius: 50 },
      center,
    );
    expect(point.x).toBeCloseTo(100, 5);
    expect(point.y).toBeCloseTo(50, 5);
  });

  it("maps 3 o'clock (theta=2π) to (center.x + radius, center.y)", () => {
    const point = polar2Canvas({ theta: 2 * Math.PI, radius: 50 }, center);
    expect(point.x).toBeCloseTo(150, 5);
    expect(point.y).toBeCloseTo(100, 5);
  });
});

describe("canvas2Polar", () => {
  const center: Vector = { x: 100, y: 100 };

  it("inverts polar2Canvas at the cardinal points (within ±2π wrap)", () => {
    // 9 o'clock — atan2(0, -50) = π exactly.
    expect(canvas2Polar({ x: 50, y: 100 }, center)).toBeCloseTo(Math.PI, 5);
    // 12 o'clock — atan2(-50, 0) = -π/2; the gesture handler then
    // wraps via `normalizeAngle` so the slider sees 3π/2.
    expect(canvas2Polar({ x: 100, y: 50 }, center)).toBeCloseTo(
      -Math.PI / 2,
      5,
    );
    // 3 o'clock — atan2(0, 50) = 0; gesture handler wraps to 2π-ε.
    expect(canvas2Polar({ x: 150, y: 100 }, center)).toBeCloseTo(0, 5);
  });
});

describe("containedInSquare", () => {
  const center: Vector = { x: 100, y: 100 };

  it("returns true for the centre point", () => {
    expect(containedInSquare(center, center, 44)).toBe(true);
  });

  it("returns true on the edge of the square (inclusive bounds)", () => {
    expect(containedInSquare({ x: 78, y: 100 }, center, 44)).toBe(true);
    expect(containedInSquare({ x: 122, y: 100 }, center, 44)).toBe(true);
    expect(containedInSquare({ x: 100, y: 78 }, center, 44)).toBe(true);
    expect(containedInSquare({ x: 100, y: 122 }, center, 44)).toBe(true);
  });

  it("returns false outside the square", () => {
    expect(containedInSquare({ x: 50, y: 100 }, center, 44)).toBe(false);
    expect(containedInSquare({ x: 100, y: 200 }, center, 44)).toBe(false);
  });
});

describe("arc", () => {
  it("emits the legacy SVG arc fragment with R=100 and the requested flags", () => {
    expect(arc(150, 100, false, true)).toBe("A 100 100 0 0 1 150 100");
    expect(arc(150, 100, true, true)).toBe("A 100 100 0 1 1 150 100");
    expect(arc(150, 100, false, false)).toBe("A 100 100 0 0 0 150 100");
    expect(arc(150, 100, true, false)).toBe("A 100 100 0 1 0 150 100");
  });

  it("defaults large=false and sweep=false when omitted", () => {
    expect(arc(150, 100)).toBe("A 100 100 0 0 0 150 100");
  });
});
