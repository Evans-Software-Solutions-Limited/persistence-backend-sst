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
    ...over,
  };
  return { ...renderWithTheme(<QuickAddSheetPresenter {...props} />), props };
}

describe("QuickAddSheetPresenter", () => {
  it("prompts for ≥2 chars before searching", () => {
    const { getByTestId } = render({ query: "o" });
    expect(getByTestId("quick-add-hint")).toBeTruthy();
  });

  it("renders results and selects a food", () => {
    const { getByTestId, props } = render({ query: "oat", results: [food] });
    fireEvent.press(getByTestId("quick-add-result-f1"));
    expect(props.onSelect).toHaveBeenCalledWith(food);
  });

  it("shows an empty state when search returns nothing", () => {
    const { getByTestId } = render({ query: "zzz", results: [] });
    expect(getByTestId("quick-add-empty")).toBeTruthy();
  });

  it("renders the selected-food detail with serving + slot controls", () => {
    const { getByTestId } = render({ selected: food });
    expect(getByTestId("quick-add-detail")).toBeTruthy();
    expect(getByTestId("quick-add-servings")).toBeTruthy();
    expect(getByTestId("quick-add-slot-lunch")).toBeTruthy();
    // Open Food Facts attribution (ODbL) is shown for OFF-sourced foods.
    expect(getByTestId("quick-add-off-credit")).toBeTruthy();
  });

  it("steps servings, picks a slot, and confirms", () => {
    const { getByTestId, props } = render({ selected: food });
    fireEvent.press(getByTestId("quick-add-servings-plus"));
    expect(props.onServingsChange).toHaveBeenCalledWith(1.5);
    fireEvent.press(getByTestId("quick-add-servings-minus"));
    expect(props.onServingsChange).toHaveBeenCalledWith(0.5);
    fireEvent.press(getByTestId("quick-add-slot-dinner"));
    expect(props.onSlotChange).toHaveBeenCalledWith("dinner");
    fireEvent.press(getByTestId("quick-add-confirm"));
    expect(props.onAdd).toHaveBeenCalled();
  });

  it("goes back to search from the detail", () => {
    const { getByTestId, props } = render({ selected: food });
    fireEvent.press(getByTestId("quick-add-back"));
    expect(props.onClearSelection).toHaveBeenCalled();
  });
});
