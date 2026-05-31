import { renderWithTheme } from "../../../../../__tests__/test-utils";
import { Text } from "../../Text";
import { MultiRing, Ring } from "../Ring";

describe("Ring", () => {
  it("renders a progressbar with the clamped percent as its a11y value", () => {
    const { getByTestId } = renderWithTheme(
      <Ring pct={0.6} testID="ring" accessibilityLabel="Move ring" />,
    );
    const node = getByTestId("ring");
    expect(node.props.accessibilityRole).toBe("progressbar");
    expect(node.props.accessibilityValue).toEqual({
      now: 60,
      min: 0,
      max: 100,
    });
  });

  it("clamps pct above 1 / below 0", () => {
    const { getByTestId: hi } = renderWithTheme(
      <Ring pct={1.5} testID="ring" />,
    );
    expect(hi("ring").props.accessibilityValue.now).toBe(100);
    const { getByTestId: lo } = renderWithTheme(
      <Ring pct={-1} testID="ring2" />,
    );
    expect(lo("ring2").props.accessibilityValue.now).toBe(0);
  });

  it("renders a centre overlay child", () => {
    const { getByText } = renderWithTheme(
      <Ring pct={0.5} testID="ring">
        <Text testID="ring-center">74%</Text>
      </Ring>,
    );
    expect(getByText("74%")).toBeTruthy();
  });

  it("renders with custom size + stroke + glow", () => {
    const { getByTestId } = renderWithTheme(
      <Ring pct={0.5} size={120} stroke={12} glow testID="ring" />,
    );
    expect(getByTestId("ring")).toBeTruthy();
  });

  it("jumps to final state under reduced motion", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const reanimated = require("react-native-reanimated");
    const spy = jest
      .spyOn(reanimated, "useReducedMotion")
      .mockReturnValue(true);
    try {
      const { getByTestId } = renderWithTheme(
        <Ring pct={0.9} testID="ring-rm" />,
      );
      expect(getByTestId("ring-rm").props.accessibilityValue.now).toBe(90);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("MultiRing", () => {
  const RINGS = [
    { pct: 0.74, color: "#22D3EE" },
    { pct: 0.42, color: "#FB923C" },
    { pct: 0.88, color: "#F5C518" },
  ];

  it("renders concentric rings", () => {
    const { getByTestId } = renderWithTheme(
      <MultiRing rings={RINGS} testID="mr" accessibilityLabel="Today rings" />,
    );
    expect(getByTestId("mr")).toBeTruthy();
    expect(getByTestId("mr").props.accessibilityRole).toBe("progressbar");
  });

  it("renders a centre overlay", () => {
    const { getByText } = renderWithTheme(
      <MultiRing rings={RINGS} testID="mr">
        <Text>TODAY</Text>
      </MultiRing>,
    );
    expect(getByText("TODAY")).toBeTruthy();
  });

  it("skips rings whose computed radius collapses to <= 0", () => {
    // Many rings at a large stroke on a small size — inner rings drop out.
    const many = Array.from({ length: 8 }, (_, i) => ({
      pct: 0.5,
      color: "#22D3EE",
      track: i % 2 ? "#111" : undefined,
    }));
    const { getByTestId } = renderWithTheme(
      <MultiRing size={60} stroke={11} rings={many} testID="mr" />,
    );
    expect(getByTestId("mr")).toBeTruthy();
  });

  it("renders with glow disabled", () => {
    const { getByTestId } = renderWithTheme(
      <MultiRing rings={RINGS} glow={false} testID="mr" />,
    );
    expect(getByTestId("mr")).toBeTruthy();
  });
});
