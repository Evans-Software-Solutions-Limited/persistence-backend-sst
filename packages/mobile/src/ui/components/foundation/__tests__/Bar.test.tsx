import { renderWithTheme } from "../../../../../__tests__/test-utils";
import { Bar } from "../Bar";

describe("Bar", () => {
  it("renders a progressbar with the clamped percent as its a11y value", () => {
    const { getByTestId } = renderWithTheme(
      <Bar pct={0.42} testID="bar" accessibilityLabel="Move ring" />,
    );
    const node = getByTestId("bar");
    expect(node.props.accessibilityRole).toBe("progressbar");
    expect(node.props.accessibilityValue).toEqual({
      now: 42,
      min: 0,
      max: 100,
    });
  });

  it("clamps pct above 1 to 100%", () => {
    const { getByTestId } = renderWithTheme(<Bar pct={1.7} testID="bar" />);
    expect(getByTestId("bar").props.accessibilityValue.now).toBe(100);
  });

  it("clamps pct below 0 to 0%", () => {
    const { getByTestId } = renderWithTheme(<Bar pct={-0.5} testID="bar" />);
    expect(getByTestId("bar").props.accessibilityValue.now).toBe(0);
  });

  it("renders the animated fill", () => {
    const { getByTestId } = renderWithTheme(<Bar pct={0.5} testID="bar" />);
    expect(getByTestId("bar-fill")).toBeTruthy();
  });

  it("applies a custom height + colours", () => {
    const { getByTestId } = renderWithTheme(
      <Bar
        pct={0.5}
        height={10}
        color="#F5C518"
        track="#1A1D29"
        testID="bar"
      />,
    );
    const node = getByTestId("bar");
    const flat = Array.isArray(node.props.style)
      ? Object.assign({}, ...node.props.style)
      : node.props.style;
    expect(flat.height).toBe(10);
    expect(flat.backgroundColor).toBe("#1A1D29");
  });

  it("renders with glow without throwing", () => {
    const { getByTestId } = renderWithTheme(
      <Bar pct={0.8} glow testID="bar" />,
    );
    expect(getByTestId("bar-fill")).toBeTruthy();
  });
});

describe("Bar with reduced motion", () => {
  it("jumps to final state when reduce-motion is enabled", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const reanimated = require("react-native-reanimated");
    const spy = jest
      .spyOn(reanimated, "useReducedMotion")
      .mockReturnValue(true);
    try {
      const { getByTestId } = renderWithTheme(
        <Bar pct={0.9} testID="bar-rm" />,
      );
      expect(getByTestId("bar-rm")).toBeTruthy();
      expect(getByTestId("bar-rm").props.accessibilityValue.now).toBe(90);
      expect(getByTestId("bar-rm-fill")).toBeTruthy();
    } finally {
      spy.mockRestore();
    }
  });
});
