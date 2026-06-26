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

  it("steps up with +", () => {
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
