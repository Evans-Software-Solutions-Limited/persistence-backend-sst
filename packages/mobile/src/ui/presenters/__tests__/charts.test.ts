import { computePath } from "../charts";

describe("computePath", () => {
  const dims = { w: 100, h: 50 };

  it("returns empty paths for an empty series", () => {
    expect(computePath([], dims)).toEqual({
      line: "",
      area: "",
      lastPoint: [0, 50],
      points: [],
    });
  });

  it("places a single point at x=0", () => {
    const r = computePath([5], dims);
    expect(r.points).toEqual([[0, 25]]); // flat → mid-height
    expect(r.lastPoint).toEqual([0, 25]);
  });

  it("renders a flat series at mid-height (no divide-by-zero)", () => {
    const r = computePath([10, 10, 10], dims);
    expect(r.points.every(([, y]) => y === 25)).toBe(true);
  });

  it("maps an ascending series across the width, inverting Y", () => {
    const r = computePath([0, 10], dims);
    expect(r.points[0]).toEqual([0, 50]); // min → bottom
    expect(r.points[1]).toEqual([100, 0]); // max → top
    expect(r.line).toBe("M 0 50 L 100 0");
    expect(r.area).toBe("M 0 50 L 100 0 L 100 50 L 0 50 Z");
  });

  it("pads the value range when padFrac > 0", () => {
    const r = computePath([0, 10], dims, 0.5);
    // pad = 5 → range [-5, 15]; 0 → y = 50 - (5/20)*50 = 37.5
    expect(r.points[0][1]).toBeCloseTo(37.5);
  });
});
