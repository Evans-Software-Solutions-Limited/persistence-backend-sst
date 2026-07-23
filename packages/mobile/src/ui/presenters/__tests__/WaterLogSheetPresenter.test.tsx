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

  // ── device-QA #5/#7 — forwards the preferred volume unit ─────────────────

  it("defaults to litres and forwards volumeUnit to the tracker", () => {
    const { getByText } = render({ cups: 4, goal: 8 });
    // 4 cups × 0.25 = 1.0 L, goal 8 × 0.25 = 2.0 L.
    expect(getByText("1.0")).toBeTruthy();
    expect(getByText("/ 2.0 L")).toBeTruthy();
  });

  it("volumeUnit=cups shows cups in the tracker and the helper copy", () => {
    const { getByText } = render({ cups: 4, goal: 8, volumeUnit: "cups" });
    expect(getByText("4")).toBeTruthy();
    expect(getByText("/ 8 cups")).toBeTruthy();
    expect(getByText(/1 cup each/)).toBeTruthy();
  });
});
