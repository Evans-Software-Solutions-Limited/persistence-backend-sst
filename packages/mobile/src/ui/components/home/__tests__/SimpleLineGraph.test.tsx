import { render } from "@testing-library/react-native";
import { SimpleLineGraph } from "@/ui/components/home/SimpleLineGraph";

describe("SimpleLineGraph", () => {
  it("renders an empty view when data is empty", () => {
    const { toJSON } = render(
      <SimpleLineGraph data={[]} width={150} height={60} color="#00D4FF" />,
    );
    const json = toJSON() as { type?: string } | null;
    // No SVG child — falls back to a bare View with fixed dimensions.
    expect(json).not.toBeNull();
    expect(json?.type).toBe("View");
  });

  it("renders an SVG path when data has multiple points", () => {
    const { toJSON } = render(
      <SimpleLineGraph
        data={[10, 20, 15, 25]}
        width={150}
        height={60}
        color="#00D4FF"
      />,
    );
    const json = JSON.stringify(toJSON());
    // jest-expo renders react-native-svg primitives as Views; the
    // reliable signal that the Path fired is the `d` attribute (SVG
    // path commands). "M " always appears as the first moveTo.
    expect(json).toContain('"d":"M ');
    expect(json).toContain("#00D4FF");
  });

  it("tolerates a single-point series without dividing by zero", () => {
    const { toJSON } = render(
      <SimpleLineGraph data={[42]} width={150} height={60} color="#22C55E" />,
    );
    const json = JSON.stringify(toJSON());
    // Single-point series emits a path with one coordinate — no NaN.
    expect(json).toContain('"d":"M ');
    expect(json).not.toContain("NaN");
  });

  it("tolerates a flat series where min === max without NaN", () => {
    const { toJSON } = render(
      <SimpleLineGraph
        data={[5000, 5000, 5000]}
        width={150}
        height={60}
        color="#00D4FF"
      />,
    );
    expect(JSON.stringify(toJSON())).not.toContain("NaN");
  });
});
