import { fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import {
  RecipesLibraryPresenter,
  type MealRowVM,
  type RecipeRowVM,
  type RecipesLibraryPresenterProps,
} from "../RecipesLibraryPresenter";

const meal: MealRowVM = {
  id: "m1",
  name: "Standard breakfast",
  kcal: 480,
  itemsSummary: "Oats + Yogurt",
};

const recipe: RecipeRowVM = {
  id: "r1",
  name: "Protein oats",
  kcal: 420,
  proteinG: 32,
  carbsG: 58,
  fatG: 8,
  secondaryLine: "1 serving · My recipe",
};

function render(over: Partial<RecipesLibraryPresenterProps> = {}) {
  const props: RecipesLibraryPresenterProps = {
    tab: "Meals",
    onTabChange: jest.fn(),
    query: "",
    onQueryChange: jest.fn(),
    meals: [meal],
    recipes: [recipe],
    hasData: true,
    isLoading: false,
    isRefreshing: false,
    error: null,
    onRefresh: jest.fn(),
    onSelectMeal: jest.fn(),
    onSelectRecipe: jest.fn(),
    onAdd: jest.fn(),
    onBack: jest.fn(),
    ...over,
  };
  return { ...renderWithTheme(<RecipesLibraryPresenter {...props} />), props };
}

describe("RecipesLibraryPresenter", () => {
  it("renders the header, tabs, and search box", () => {
    const { getByTestId } = render();
    expect(getByTestId("recipes-library-header")).toBeTruthy();
    expect(getByTestId("recipes-library-tabs")).toBeTruthy();
    expect(getByTestId("recipes-library-search")).toBeTruthy();
  });

  it("Back and Add fire their handlers", () => {
    const { getByTestId, props } = render();
    fireEvent.press(getByTestId("recipes-library-back"));
    fireEvent.press(getByTestId("recipes-library-add"));
    expect(props.onBack).toHaveBeenCalledTimes(1);
    expect(props.onAdd).toHaveBeenCalledTimes(1);
  });

  it("switching the segmented tab calls onTabChange", () => {
    const { getByTestId, props } = render();
    fireEvent.press(getByTestId("recipes-library-tabs-option-Recipes"));
    expect(props.onTabChange).toHaveBeenCalledWith("Recipes");
  });

  it("typing in the search box calls onQueryChange", () => {
    const { getByTestId, props } = render();
    fireEvent.changeText(getByTestId("recipes-library-search-input"), "oats");
    expect(props.onQueryChange).toHaveBeenCalledWith("oats");
  });

  it("renders meal rows and presses through to onSelectMeal", () => {
    const { getByTestId, getByText, props } = render({ tab: "Meals" });
    expect(getByText("Standard breakfast")).toBeTruthy();
    expect(getByText("Oats + Yogurt")).toBeTruthy();
    expect(getByText("480 KCAL")).toBeTruthy();
    fireEvent.press(getByTestId("recipes-library-meal-m1"));
    expect(props.onSelectMeal).toHaveBeenCalledWith("m1");
  });

  it("omits the item-summary line when unavailable", () => {
    const { queryByText } = render({
      tab: "Meals",
      meals: [{ ...meal, itemsSummary: null }],
    });
    expect(queryByText("Oats + Yogurt")).toBeNull();
  });

  it("renders recipe rows with macro pills, a per-serving affordance, and presses through to onSelectRecipe", () => {
    const { getByTestId, getByText, props } = render({ tab: "Recipes" });
    expect(getByText("Protein oats")).toBeTruthy();
    expect(getByText("P 32g")).toBeTruthy();
    expect(getByText("C 58g")).toBeTruthy();
    expect(getByText("F 8g")).toBeTruthy();
    expect(getByText("1 serving · My recipe")).toBeTruthy();
    expect(getByText("per serving")).toBeTruthy();
    fireEvent.press(getByTestId("recipes-library-recipe-r1"));
    expect(props.onSelectRecipe).toHaveBeenCalledWith("r1");
  });

  it("shows a kcal placeholder and no macro pills when a recipe's totals aren't materialised yet", () => {
    const { getByText, queryByText } = render({
      tab: "Recipes",
      recipes: [
        {
          ...recipe,
          kcal: null,
          proteinG: null,
          carbsG: null,
          fatG: null,
        },
      ],
    });
    expect(getByText("—")).toBeTruthy();
    expect(queryByText("P 32g")).toBeNull();
    expect(queryByText("C 58g")).toBeNull();
    expect(queryByText("F 8g")).toBeNull();
  });

  it("shows a blocking loader when loading with no cache", () => {
    const { getByTestId, queryByTestId } = render({
      isLoading: true,
      hasData: false,
    });
    expect(getByTestId("recipes-library-screen")).toBeTruthy();
    expect(queryByTestId("recipes-library-tabs")).toBeNull();
  });

  it("shows an error state when the fetch fails with no cache", () => {
    const { getByText, props } = render({
      isLoading: false,
      hasData: false,
      error: { code: "network", message: "down" } as never,
    });
    const retry = getByText("Retry");
    fireEvent.press(retry);
    expect(props.onRefresh).toHaveBeenCalled();
  });

  it("shows the empty state for an empty Meals list", () => {
    const { getByTestId, getByText } = render({ tab: "Meals", meals: [] });
    expect(getByTestId("recipes-library-empty")).toBeTruthy();
    expect(getByText("No saved meals yet")).toBeTruthy();
  });

  it("shows the empty state for an empty Recipes list", () => {
    const { getByText } = render({ tab: "Recipes", recipes: [] });
    expect(getByText("No recipes yet")).toBeTruthy();
  });

  it("shows a 'nothing matches' empty state when a search yields no rows", () => {
    const { getByText } = render({ tab: "Meals", meals: [], query: "zzz" });
    expect(getByText("Nothing matches")).toBeTruthy();
  });
});
