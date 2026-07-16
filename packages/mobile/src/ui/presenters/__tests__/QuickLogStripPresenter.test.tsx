import { fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import {
  QuickLogStripPresenter,
  type QuickLogStripProps,
} from "../QuickLogStripPresenter";

function render(over: Partial<QuickLogStripProps> = {}) {
  const props: QuickLogStripProps = {
    onWeighIn: jest.fn(),
    onLogMeal: jest.fn(),
    onLogWater: jest.fn(),
    onSleep: jest.fn(),
    ...over,
  };
  return { ...renderWithTheme(<QuickLogStripPresenter {...props} />), props };
}

describe("QuickLogStripPresenter", () => {
  it("renders all four quick-log tiles, including Sleep", () => {
    const { getByText } = render();
    expect(getByText("Weigh in")).toBeTruthy();
    expect(getByText("Log meal")).toBeTruthy();
    expect(getByText("Water")).toBeTruthy();
    expect(getByText("Sleep")).toBeTruthy();
  });

  it("fires onWeighIn/onLogMeal/onLogWater/onSleep on tap", () => {
    const { getByText, props } = render();
    fireEvent.press(getByText("Weigh in"));
    expect(props.onWeighIn).toHaveBeenCalledTimes(1);
    fireEvent.press(getByText("Log meal"));
    expect(props.onLogMeal).toHaveBeenCalledTimes(1);
    fireEvent.press(getByText("Water"));
    expect(props.onLogWater).toHaveBeenCalledTimes(1);
    fireEvent.press(getByText("Sleep"));
    expect(props.onSleep).toHaveBeenCalledTimes(1);
  });

  it("uses the default testID", () => {
    const { getByTestId } = render();
    expect(getByTestId("quick-log-strip")).toBeTruthy();
  });
});
