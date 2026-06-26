import { fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import {
  WaterLogSheetPresenter,
  type WaterLogSheetProps,
} from "../WaterLogSheetPresenter";

function render(over: Partial<WaterLogSheetProps> = {}) {
  const props: WaterLogSheetProps = {
    visible: true,
    onClose: jest.fn(),
    cups: 4,
    goal: 8,
    onSetCups: jest.fn(),
    ...over,
  };
  return { ...renderWithTheme(<WaterLogSheetPresenter {...props} />), props };
}

describe("WaterLogSheetPresenter", () => {
  it("renders the shared water tracker inside the sheet", () => {
    const { getByTestId } = render();
    expect(getByTestId("water-log-tracker")).toBeTruthy();
    expect(getByTestId("water-log-done")).toBeTruthy();
  });

  it("sets cups via the tracker", () => {
    const { getByTestId, props } = render();
    fireEvent.press(getByTestId("fuel-water-plus"));
    expect(props.onSetCups).toHaveBeenCalledWith(5);
  });

  it("closes on Done", () => {
    const { getByTestId, props } = render();
    fireEvent.press(getByTestId("water-log-done"));
    expect(props.onClose).toHaveBeenCalled();
  });
});
