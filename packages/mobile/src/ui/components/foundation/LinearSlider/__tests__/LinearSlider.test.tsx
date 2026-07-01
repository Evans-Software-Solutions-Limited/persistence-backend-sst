import { render } from "@testing-library/react-native";
import { LinearSlider } from "../LinearSlider";

/**
 * Smoke coverage only — `react-native-gesture-handler` is globally mocked as
 * a no-op passthrough (`__tests__/setup.ts`), so drag/tap behaviour isn't
 * exercisable here. The interaction math (touch → value, value → thumb
 * position) is covered exhaustively by `math.test.ts`; this file is excluded
 * from the coverage threshold (package.json), mirroring `SemiCircleSlider`.
 */
describe("LinearSlider", () => {
  it("renders without crashing at the min/max/mid of its range", () => {
    const { getByTestId, rerender } = render(
      <LinearSlider
        min={-1}
        max={1}
        value={-1}
        onValueChange={jest.fn()}
        thumbBorderColor="#22D3EE"
        testID="test-slider"
      />,
    );
    expect(getByTestId("test-slider")).toBeTruthy();

    rerender(
      <LinearSlider
        min={-1}
        max={1}
        value={0}
        onValueChange={jest.fn()}
        thumbBorderColor="#22D3EE"
        testID="test-slider"
      />,
    );
    expect(getByTestId("test-slider")).toBeTruthy();

    rerender(
      <LinearSlider
        min={-1}
        max={1}
        value={1}
        onValueChange={jest.fn()}
        thumbBorderColor="#22D3EE"
        testID="test-slider"
      />,
    );
    expect(getByTestId("test-slider")).toBeTruthy();
  });

  it("renders a fill bar when fillColor is supplied", () => {
    const { getByTestId } = render(
      <LinearSlider
        min={0}
        max={100}
        value={40}
        onValueChange={jest.fn()}
        fillColor="#22D3EE"
        thumbBorderColor="#22D3EE"
        testID="test-slider"
      />,
    );
    expect(getByTestId("test-slider")).toBeTruthy();
  });

  it("renders a custom trackBackground instead of the default track", () => {
    const { getByTestId } = render(
      <LinearSlider
        min={0}
        max={100}
        value={40}
        onValueChange={jest.fn()}
        thumbBorderColor="#22D3EE"
        trackBackground={<></>}
        testID="test-slider"
      />,
    );
    expect(getByTestId("test-slider")).toBeTruthy();
  });

  it("exposes the accessibility value + disabled state", () => {
    const { getByTestId } = render(
      <LinearSlider
        min={0}
        max={10}
        value={3}
        onValueChange={jest.fn()}
        thumbBorderColor="#22D3EE"
        disabled
        testID="test-slider"
      />,
    );
    const node = getByTestId("test-slider");
    expect(node.props.accessibilityValue).toEqual({ min: 0, max: 10, now: 3 });
    expect(node.props.accessibilityState.disabled).toBe(true);
  });

  it("renders with the glow shadow enabled (goal-slider variant)", () => {
    const { getByTestId } = render(
      <LinearSlider
        min={-1}
        max={1}
        value={0.5}
        onValueChange={jest.fn()}
        thumbBorderColor="#F5C518"
        glow
        testID="test-slider"
      />,
    );
    expect(getByTestId("test-slider")).toBeTruthy();
  });
});
