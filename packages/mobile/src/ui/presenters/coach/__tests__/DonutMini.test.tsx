import { renderWithTheme } from "../../../../../__tests__/test-utils";
import { DonutMini, computeDonutSegments } from "../DonutMini";

describe("computeDonutSegments", () => {
  const C = 100; // pretend circumference

  it("splits the circle by each segment's fraction of the total", () => {
    const out = computeDonutSegments(
      4,
      [
        { color: "#a", count: 2 }, // 50%
        { color: "#b", count: 1 }, // 25%
        { color: "#c", count: 1 }, // 25%
      ],
      C,
    );
    expect(out[0].dash).toBeCloseTo(50);
    expect(out[1].dash).toBeCloseTo(25);
    expect(out[2].dash).toBeCloseTo(25);
    // gap = circumference - dash
    expect(out[0].gap).toBeCloseTo(50);
    // offset is the running negated sum of prior dashes
    expect(out[0].offset).toBeCloseTo(-0);
    expect(out[1].offset).toBeCloseTo(-50);
    expect(out[2].offset).toBeCloseTo(-75);
  });

  it("returns zero-length segments when total is 0 (no divide-by-zero)", () => {
    const out = computeDonutSegments(
      0,
      [
        { color: "#a", count: 0 },
        { color: "#b", count: 0 },
      ],
      C,
    );
    expect(out.every((s) => s.dash === 0)).toBe(true);
    expect(out.every((s) => s.gap === C)).toBe(true);
  });

  it("offsets accumulate so segments don't overlap", () => {
    const out = computeDonutSegments(
      10,
      [
        { color: "#a", count: 3 },
        { color: "#b", count: 7 },
      ],
      C,
    );
    expect(out[1].offset).toBeCloseTo(-30);
  });
});

describe("DonutMini", () => {
  it("renders the total + CLIENTS label", () => {
    const { getByText } = renderWithTheme(
      <DonutMini
        total={8}
        segments={[
          { color: "#34D399", count: 4 },
          { color: "#F5C518", count: 2 },
          { color: "#FB923C", count: 2 },
        ]}
      />,
    );
    expect(getByText("8")).toBeTruthy();
    expect(getByText("Clients")).toBeTruthy();
  });

  it("renders an empty (total 0) donut without crashing", () => {
    const { getByText, getByTestId } = renderWithTheme(
      <DonutMini
        testID="donut"
        total={0}
        segments={[{ color: "#34D399", count: 0 }]}
      />,
    );
    expect(getByTestId("donut")).toBeTruthy();
    expect(getByText("0")).toBeTruthy();
  });
});
