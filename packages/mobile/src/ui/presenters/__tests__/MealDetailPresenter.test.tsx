import { fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import {
  MealDetailPresenter,
  type MealDetailPresenterProps,
} from "../MealDetailPresenter";

function render(over: Partial<MealDetailPresenterProps> = {}) {
  const props: MealDetailPresenterProps = {
    found: true,
    isLoading: false,
    error: null,
    onRetry: jest.fn(),
    onBack: jest.fn(),
    name: "Standard breakfast",
    itemsSummary: "Oats + Yogurt",
    kcal: 480,
    proteinG: 30,
    carbsG: 50,
    fatG: 12,
    onLogToToday: jest.fn(),
    isLogging: false,
    ...over,
  };
  return { ...renderWithTheme(<MealDetailPresenter {...props} />), props };
}

describe("MealDetailPresenter", () => {
  it("renders the meal's name, item summary, and macros", () => {
    const { getByTestId, getByText } = render();
    expect(getByTestId("meal-detail-name").props.children).toBe(
      "Standard breakfast",
    );
    expect(getByText("Oats + Yogurt")).toBeTruthy();
    expect(getByText("480 KCAL")).toBeTruthy();
    expect(getByText("P 30G")).toBeTruthy();
    expect(getByText("C 50G")).toBeTruthy();
    expect(getByText("F 12G")).toBeTruthy();
  });

  it("omits the item summary line when unavailable", () => {
    const { queryByText } = render({ itemsSummary: null });
    expect(queryByText("Oats + Yogurt")).toBeNull();
  });

  it("Back and Log to today fire their handlers", () => {
    const { getByTestId, props } = render();
    fireEvent.press(getByTestId("meal-detail-back"));
    fireEvent.press(getByTestId("meal-detail-log"));
    expect(props.onBack).toHaveBeenCalledTimes(1);
    expect(props.onLogToToday).toHaveBeenCalledTimes(1);
  });

  it("shows a blocking loader while loading with nothing found yet", () => {
    const { getByTestId, queryByTestId } = render({
      found: false,
      isLoading: true,
    });
    expect(getByTestId("meal-detail-screen")).toBeTruthy();
    expect(queryByTestId("meal-detail-name")).toBeNull();
  });

  it("shows an error state when the load fails with nothing found", () => {
    const { getByText, props } = render({
      found: false,
      error: { code: "network", message: "down" } as never,
    });
    fireEvent.press(getByText("Retry"));
    expect(props.onRetry).toHaveBeenCalledTimes(1);
  });

  it("shows a not-found state when nothing is found and there's no error/loading", () => {
    const { getByTestId } = render({ found: false });
    expect(getByTestId("meal-detail-not-found")).toBeTruthy();
  });
});
