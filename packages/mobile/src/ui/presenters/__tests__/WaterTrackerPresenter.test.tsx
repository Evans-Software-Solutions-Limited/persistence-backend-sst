import { fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import {
  WaterTrackerPresenter,
  type WaterTrackerProps,
} from "../WaterTrackerPresenter";

function render(over: Partial<WaterTrackerProps> = {}) {
  const props: WaterTrackerProps = {
    cups: 6,
    goal: 8,
    onSetCups: jest.fn(),
    ...over,
  };
  return { ...renderWithTheme(<WaterTrackerPresenter {...props} />), props };
}

describe("WaterTrackerPresenter", () => {
  it("renders the count and a cup per goal", () => {
    const { getByTestId } = render();
    expect(getByTestId("fuel-water-count")).toBeTruthy();
    expect(getByTestId("fuel-water-cup-0")).toBeTruthy();
    expect(getByTestId("fuel-water-cup-7")).toBeTruthy();
  });

  it("displays cups as litres (8 cups = 2.0 L) with the goal in litres", () => {
    // 6 cups × 0.25 = 1.5 L, goal 8 cups × 0.25 = 2.0 L → "1.5" + "/ 2.0 L".
    const { getByText } = render({ cups: 6, goal: 8 });
    expect(getByText("1.5")).toBeTruthy();
    expect(getByText("/ 2.0 L")).toBeTruthy();
  });

  it("shows a 2-dp litres value when the count lands off a 0.5 L mark", () => {
    // 5 cups × 0.25 = 1.25 L (a 0.25 L step off 1.0 L).
    const { getByText } = render({ cups: 5, goal: 8 });
    expect(getByText("1.25")).toBeTruthy();
  });

  it("labels the grid cells in litres (0.25 L per cup)", () => {
    const { getByLabelText } = render({ cups: 0, goal: 8 });
    expect(getByLabelText("Set water to 0.25 litres")).toBeTruthy();
    expect(getByLabelText("Set water to 2.0 litres")).toBeTruthy(); // cup 8
  });

  it("steps by one cup (= 0.25 L) — + sends cups+1", () => {
    // A 0.25 L step maps to exactly ±1 cup: the wire grain stays integer cups.
    const { getByTestId, props } = render();
    fireEvent.press(getByTestId("fuel-water-plus"));
    expect(props.onSetCups).toHaveBeenCalledWith(7);
  });

  it("steps down with - and floors at 0", () => {
    const { getByTestId, props } = render({ cups: 0 });
    fireEvent.press(getByTestId("fuel-water-minus"));
    expect(props.onSetCups).toHaveBeenCalledWith(0);
  });

  it("sets the absolute cup count when a cup is tapped", () => {
    const { getByTestId, props } = render();
    fireEvent.press(getByTestId("fuel-water-cup-3"));
    expect(props.onSetCups).toHaveBeenCalledWith(4);
  });

  it("guards a zero goal (renders at least one cup)", () => {
    const { getByTestId } = render({ goal: 0, cups: 0 });
    expect(getByTestId("fuel-water-cup-0")).toBeTruthy();
  });
});
