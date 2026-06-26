import { fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import {
  QuickAddSheetPresenter,
  type QuickAddSheetProps,
} from "../QuickAddSheetPresenter";
import type { Food } from "@/domain/models/nutrition";

const food: Food = {
  id: "f1",
  name: "Oatmeal",
  brand: "Quaker",
  barcode: "123",
  kcal: 150,
  proteinG: 5,
  carbsG: 27,
  fatG: 3,
  servingSize: 40,
  servingUnit: "g",
  source: "openfoodfacts",
  createdBy: null,
};

function render(over: Partial<QuickAddSheetProps> = {}) {
  const props: QuickAddSheetProps = {
    visible: true,
    onClose: jest.fn(),
    mealLabel: "Breakfast",
    stage: "menu",
    aiLocked: true,
    yesterday: { items: ["Oatmeal", "Greek yogurt"], kcal: 480 },
    savedMeals: [{ id: "m1", name: "Standard breakfast", kcal: 480 }],
    onLogYesterday: jest.fn(),
    onLogMeal: jest.fn(),
    onScan: jest.fn(),
    onSnap: jest.fn(),
    onSearch: jest.fn(),
    onManual: jest.fn(),
    query: "",
    onQueryChange: jest.fn(),
    results: [],
    isSearching: false,
    selected: null,
    onSelect: jest.fn(),
    onClearSelection: jest.fn(),
    servings: 1,
    onServingsChange: jest.fn(),
    slot: "breakfast",
    onSlotChange: jest.fn(),
    onAdd: jest.fn(),
    onBackToMenu: jest.fn(),
    ...over,
  };
  return { ...renderWithTheme(<QuickAddSheetPresenter {...props} />), props };
}

describe("QuickAddSheetPresenter — menu stage", () => {
  it("renders the from-yesterday, saved-meals, and action tiles", () => {
    const { getByTestId } = render();
    expect(getByTestId("quick-add-yesterday")).toBeTruthy();
    expect(getByTestId("quick-add-meal-m1")).toBeTruthy();
    expect(getByTestId("quick-add-tile-scan")).toBeTruthy();
    expect(getByTestId("quick-add-tile-snap")).toBeTruthy();
    expect(getByTestId("quick-add-tile-search")).toBeTruthy();
    expect(getByTestId("quick-add-tile-manual")).toBeTruthy();
  });

  it("shows the AI badge on Snap when locked", () => {
    const { getByTestId } = render({ aiLocked: true });
    expect(getByTestId("quick-add-tile-snap-ai")).toBeTruthy();
  });

  it("hides from-yesterday when there's no history", () => {
    const { queryByTestId } = render({ yesterday: null });
    expect(queryByTestId("quick-add-yesterday")).toBeNull();
  });

  it("routes the menu actions", () => {
    const { getByTestId, props } = render();
    fireEvent.press(getByTestId("quick-add-yesterday"));
    fireEvent.press(getByTestId("quick-add-meal-m1"));
    fireEvent.press(getByTestId("quick-add-tile-scan"));
    fireEvent.press(getByTestId("quick-add-tile-snap"));
    fireEvent.press(getByTestId("quick-add-tile-search"));
    fireEvent.press(getByTestId("quick-add-tile-manual"));
    expect(props.onLogYesterday).toHaveBeenCalled();
    expect(props.onLogMeal).toHaveBeenCalledWith("m1");
    expect(props.onScan).toHaveBeenCalled();
    expect(props.onSnap).toHaveBeenCalled();
    expect(props.onSearch).toHaveBeenCalled();
    expect(props.onManual).toHaveBeenCalled();
  });
});

describe("QuickAddSheetPresenter — search stage", () => {
  it("prompts for ≥2 chars", () => {
    const { getByTestId } = render({ stage: "search", query: "o" });
    expect(getByTestId("quick-add-hint")).toBeTruthy();
  });

  it("selects a search result", () => {
    const { getByTestId, props } = render({
      stage: "search",
      query: "oat",
      results: [food],
    });
    fireEvent.press(getByTestId("quick-add-result-f1"));
    expect(props.onSelect).toHaveBeenCalledWith(food);
  });

  it("shows the selected-food detail with OFF credit + confirms", () => {
    const { getByTestId, props } = render({ stage: "search", selected: food });
    expect(getByTestId("quick-add-detail")).toBeTruthy();
    expect(getByTestId("quick-add-off-credit")).toBeTruthy();
    fireEvent.press(getByTestId("quick-add-servings-inc"));
    expect(props.onServingsChange).toHaveBeenCalledWith(1.5);
    fireEvent.press(getByTestId("quick-add-meal-picker-option-dinner"));
    expect(props.onSlotChange).toHaveBeenCalledWith("dinner");
    fireEvent.press(getByTestId("quick-add-confirm"));
    expect(props.onAdd).toHaveBeenCalled();
  });

  it("goes back from search to menu", () => {
    const { getByTestId, props } = render({ stage: "search" });
    fireEvent.press(getByTestId("quick-add-search-back"));
    expect(props.onBackToMenu).toHaveBeenCalled();
  });
});
