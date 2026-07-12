import { fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import {
  RecipeDetailPresenter,
  type RecipeDetailPresenterProps,
} from "../RecipeDetailPresenter";

function render(over: Partial<RecipeDetailPresenterProps> = {}) {
  const props: RecipeDetailPresenterProps = {
    found: true,
    isLoading: false,
    error: null,
    onRetry: jest.fn(),
    onBack: jest.fn(),
    name: "Chicken & rice bowl",
    emoji: "🥘",
    secondaryLine: "2 servings · My recipe",
    kcal: 640,
    proteinG: 55,
    carbsG: 70,
    fatG: 14,
    ingredients: [
      { id: "i1", label: "Chicken breast · 300 g" },
      { id: "i2", label: "Jasmine rice · 200 g" },
    ],
    instructions: "1. Marinate. 2. Cook rice. 3. Sear chicken.",
    onLogToToday: jest.fn(),
    isLogging: false,
    ...over,
  };
  return { ...renderWithTheme(<RecipeDetailPresenter {...props} />), props };
}

describe("RecipeDetailPresenter", () => {
  it("renders the recipe's name, macros, ingredients, and instructions", () => {
    const { getByText, getByTestId } = render();
    expect(getByTestId("recipe-detail-name").props.children).toBe(
      "Chicken & rice bowl",
    );
    expect(getByText("2 servings · My recipe")).toBeTruthy();
    expect(getByText("640 KCAL")).toBeTruthy();
    expect(getByText("P 55G")).toBeTruthy();
    expect(getByText("C 70G")).toBeTruthy();
    expect(getByText("F 14G")).toBeTruthy();
    expect(getByText("Chicken breast · 300 g")).toBeTruthy();
    expect(getByText("Jasmine rice · 200 g")).toBeTruthy();
    expect(getByTestId("recipe-detail-instructions")).toBeTruthy();
  });

  it("omits macro pills that are null and shows a kcal placeholder when it isn't materialised yet", () => {
    const { getByText, queryByText } = render({
      kcal: null,
      proteinG: null,
      carbsG: null,
      fatG: null,
    });
    expect(getByText("— KCAL")).toBeTruthy();
    expect(queryByText("P 55G")).toBeNull();
    expect(queryByText("C 70G")).toBeNull();
    expect(queryByText("F 14G")).toBeNull();
  });

  it("shows a fallback message when there are no ingredients", () => {
    const { getByText } = render({ ingredients: [] });
    expect(getByText("No ingredients listed.")).toBeTruthy();
  });

  it("omits the instructions section when there are none", () => {
    const { queryByTestId } = render({ instructions: null });
    expect(queryByTestId("recipe-detail-instructions")).toBeNull();
  });

  it("Back and Log to today fire their handlers", () => {
    const { getByTestId, props } = render();
    fireEvent.press(getByTestId("recipe-detail-back"));
    fireEvent.press(getByTestId("recipe-detail-log"));
    expect(props.onBack).toHaveBeenCalledTimes(1);
    expect(props.onLogToToday).toHaveBeenCalledTimes(1);
  });

  it("shows a blocking loader while loading with nothing found yet", () => {
    const { getByTestId, queryByTestId } = render({
      found: false,
      isLoading: true,
    });
    expect(getByTestId("recipe-detail-screen")).toBeTruthy();
    expect(queryByTestId("recipe-detail-name")).toBeNull();
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
    expect(getByTestId("recipe-detail-not-found")).toBeTruthy();
  });
});
