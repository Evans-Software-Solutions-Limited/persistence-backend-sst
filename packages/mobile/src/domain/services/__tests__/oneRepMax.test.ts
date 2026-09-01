import { estimateOneRepMax } from "../oneRepMax";

describe("estimateOneRepMax", () => {
  it("uses the completed load as the actual maximum for one rep", () => {
    expect(estimateOneRepMax(142.5, 1)).toBe(142.5);
  });

  it("uses Epley for completed sets of two through ten reps", () => {
    expect(estimateOneRepMax(120, 6)).toBeCloseTo(144);
    expect(estimateOneRepMax(100, 2)).toBeCloseTo(106.6666667);
    expect(estimateOneRepMax(80, 10)).toBeCloseTo(106.6666667);
  });

  it.each([
    [0, 5],
    [-1, 5],
    [Number.NaN, 5],
    [100, 0],
    [100, 11],
    [100, 2.5],
    [100, Number.POSITIVE_INFINITY],
  ])("rejects a non-qualifying load or rep count (%s, %s)", (weight, reps) => {
    expect(estimateOneRepMax(weight, reps)).toBeNull();
  });
});
