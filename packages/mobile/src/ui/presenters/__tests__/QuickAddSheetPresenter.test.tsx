import { fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import {
  QuickAddSheetPresenter,
  type QuickAddSheetProps,
} from "../QuickAddSheetPresenter";
import type { Food } from "@/domain/models/nutrition";
import type { AiDraftItem } from "../AiDraftConfirmPresenter";

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
  servingQuantity: null,
  source: "openfoodfacts",
  createdBy: null,
};

const aiItem = (over: Partial<AiDraftItem> = {}): AiDraftItem => ({
  name: "Two eggs",
  quantity: 2,
  unit: "egg",
  estimatedGrams: 100,
  kcal: 140,
  proteinG: 12,
  carbsG: 1,
  fatG: 10,
  confidence: 0.9,
  on: true,
  ...over,
});

function render(over: Partial<QuickAddSheetProps> = {}) {
  const props: QuickAddSheetProps = {
    visible: true,
    onClose: jest.fn(),
    mealLabel: "Breakfast",
    stage: "menu",
    aiLocked: true,
    aiOffline: false,
    yesterday: { items: ["Oatmeal", "Greek yogurt"], kcal: 480 },
    savedMeals: [{ id: "m1", name: "Standard breakfast", kcal: 480 }],
    onLogYesterday: jest.fn(),
    onLogMeal: jest.fn(),
    onScan: jest.fn(),
    onSnap: jest.fn(),
    onSearch: jest.fn(),
    onManual: jest.fn(),
    onDescribe: jest.fn(),
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
    describeText: "",
    onDescribeTextChange: jest.fn(),
    isEstimatingText: false,
    describeError: null,
    onSubmitDescribe: jest.fn(),
    describeItems: [],
    onToggleDescribeItem: jest.fn(),
    onEditDescribeGrams: jest.fn(),
    describeTotalKcal: 0,
    describeAdded: false,
    onConfirmDescribe: jest.fn(),
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

  it("shows a P/C/F macro line on each search result", () => {
    const { getByTestId } = render({
      stage: "search",
      query: "oat",
      results: [food],
    });
    expect(getByTestId("quick-add-result-macros-f1").props.children).toBe(
      `P ${food.proteinG}g · C ${food.carbsG}g · F ${food.fatG}g`,
    );
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

describe("QuickAddSheetPresenter — Or describe it… CTA", () => {
  it("shows the CTA when AI is allowed and routes to the describe stage", () => {
    const { getByTestId, props } = render({ aiLocked: false });
    fireEvent.press(getByTestId("quick-add-describe-cta"));
    expect(props.onDescribe).toHaveBeenCalled();
  });

  it("hides the CTA when AI is locked (entitlement)", () => {
    const { queryByTestId } = render({ aiLocked: true });
    expect(queryByTestId("quick-add-describe-cta")).toBeNull();
  });

  it("disables the CTA when offline and does not fire onDescribe", () => {
    const { getByTestId, props } = render({
      aiLocked: false,
      aiOffline: true,
    });
    fireEvent.press(getByTestId("quick-add-describe-cta"));
    expect(props.onDescribe).not.toHaveBeenCalled();
  });

  it("disables the Snap tile when offline and does not fire onSnap", () => {
    const { getByTestId, props } = render({
      aiLocked: false,
      aiOffline: true,
    });
    fireEvent.press(getByTestId("quick-add-tile-snap"));
    expect(props.onSnap).not.toHaveBeenCalled();
  });
});

describe("QuickAddSheetPresenter — describe stage", () => {
  it("disables submit until text is entered", () => {
    const { getByTestId } = render({ stage: "describe", describeText: "" });
    expect(
      getByTestId("quick-add-describe-submit").props.accessibilityState
        .disabled,
    ).toBe(true);
  });

  it("enables submit once text is entered and calls onSubmitDescribe", () => {
    const { getByTestId, props } = render({
      stage: "describe",
      describeText: "Two eggs and toast",
    });
    fireEvent.press(getByTestId("quick-add-describe-submit"));
    expect(props.onSubmitDescribe).toHaveBeenCalled();
  });

  it("shows the estimating label while in flight", () => {
    const { getByTestId } = render({
      stage: "describe",
      describeText: "Two eggs",
      isEstimatingText: true,
    });
    expect(getByTestId("quick-add-describe-submit")).toBeTruthy();
  });

  it("shows the error message on failure", () => {
    const { getByTestId } = render({
      stage: "describe",
      describeError: "Couldn't estimate that.",
    });
    expect(getByTestId("quick-add-describe-error")).toBeTruthy();
  });

  it("goes back to the menu", () => {
    const { getByTestId, props } = render({ stage: "describe" });
    fireEvent.press(getByTestId("quick-add-describe-back"));
    expect(props.onBackToMenu).toHaveBeenCalled();
  });

  it("updates the text via onDescribeTextChange", () => {
    const { getByTestId, props } = render({ stage: "describe" });
    fireEvent.changeText(getByTestId("quick-add-describe-input"), "Oats");
    expect(props.onDescribeTextChange).toHaveBeenCalledWith("Oats");
  });
});

describe("QuickAddSheetPresenter — describeConfirm stage (shared AiDraftConfirmPresenter)", () => {
  it("renders the shared confirm UI with the describe items", () => {
    const { getByTestId } = render({
      stage: "describeConfirm",
      describeItems: [aiItem()],
      describeTotalKcal: 140,
    });
    expect(getByTestId("quick-add-describe-confirm")).toBeTruthy();
    expect(
      getByTestId("quick-add-describe-confirm-summary-kcal").props.children,
    ).toBe("140");
  });

  it("toggling a row calls onToggleDescribeItem", () => {
    const { getByTestId, props } = render({
      stage: "describeConfirm",
      describeItems: [aiItem()],
    });
    fireEvent.press(getByTestId("quick-add-describe-confirm-item-0-toggle"));
    expect(props.onToggleDescribeItem).toHaveBeenCalledWith(0);
  });

  it("editing grams calls onEditDescribeGrams", () => {
    const { getByTestId, props } = render({
      stage: "describeConfirm",
      describeItems: [aiItem()],
    });
    fireEvent.changeText(
      getByTestId("quick-add-describe-confirm-item-0-grams"),
      "150",
    );
    expect(props.onEditDescribeGrams).toHaveBeenCalledWith(0, 150);
  });

  it("confirming calls onConfirmDescribe", () => {
    const { getByTestId, props } = render({
      stage: "describeConfirm",
      describeItems: [aiItem()],
    });
    fireEvent.press(getByTestId("quick-add-describe-confirm-add"));
    expect(props.onConfirmDescribe).toHaveBeenCalled();
  });

  it("shows Added state when describeAdded is true", () => {
    const { getByTestId } = render({
      stage: "describeConfirm",
      describeItems: [aiItem()],
      describeAdded: true,
    });
    expect(
      getByTestId("quick-add-describe-confirm-add").props.accessibilityState
        .disabled,
    ).toBe(true);
  });
});
