import { fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import type { Food } from "@/domain/models/nutrition";
import {
  RecipeCreatePresenter,
  type IngredientRowVM,
  type RecipeCreatePresenterProps,
} from "../RecipeCreatePresenter";

function row(over: Partial<IngredientRowVM> = {}): IngredientRowVM {
  return {
    id: "row-0",
    name: "",
    quantity: null,
    unit: "",
    foodId: null,
    foodName: null,
    ...over,
  };
}

const searchFood: Food = {
  id: "f1",
  name: "Chicken breast",
  brand: null,
  barcode: null,
  kcal: 165,
  proteinG: 31,
  carbsG: 0,
  fatG: 3.6,
  servingSize: 100,
  servingUnit: "g",
  servingQuantity: null,
  source: "openfoodfacts",
  createdBy: null,
};

function render(over: Partial<RecipeCreatePresenterProps> = {}) {
  const props: RecipeCreatePresenterProps = {
    name: "",
    onNameChange: jest.fn(),
    servings: null,
    onServingsChange: jest.fn(),
    instructions: "",
    onInstructionsChange: jest.fn(),
    rows: [row()],
    onAddRow: jest.fn(),
    onRemoveRow: jest.fn(),
    onChangeRowName: jest.fn(),
    onChangeRowQuantity: jest.fn(),
    onChangeRowUnit: jest.fn(),
    activeSearchRowId: null,
    searchQuery: "",
    searchResults: [],
    isSearching: false,
    onOpenRowSearch: jest.fn(),
    onCloseRowSearch: jest.fn(),
    onSearchQueryChange: jest.fn(),
    onLinkFood: jest.fn(),
    onCreateWithAi: jest.fn(),
    resolvingRowId: null,
    rowMessages: {},
    macroTotal: { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 },
    canSave: false,
    isSaving: false,
    onSave: jest.fn(),
    onBack: jest.fn(),
    ...over,
  };
  return { ...renderWithTheme(<RecipeCreatePresenter {...props} />), props };
}

describe("RecipeCreatePresenter", () => {
  it("renders the name/servings/instructions fields", () => {
    const { getByTestId } = render();
    expect(getByTestId("recipe-create-name")).toBeTruthy();
    expect(getByTestId("recipe-create-servings")).toBeTruthy();
    expect(getByTestId("recipe-create-instructions")).toBeTruthy();
  });

  it("fires onNameChange when typing the name", () => {
    const { getByTestId, props } = render();
    fireEvent.changeText(getByTestId("recipe-create-name"), "Sunday roast");
    expect(props.onNameChange).toHaveBeenCalledWith("Sunday roast");
  });

  it("fires onServingsChange with a parsed number, and null when cleared", () => {
    const { getByTestId, props } = render();
    fireEvent.changeText(getByTestId("recipe-create-servings"), "4");
    expect(props.onServingsChange).toHaveBeenCalledWith(4);
    fireEvent.changeText(getByTestId("recipe-create-servings"), "");
    expect(props.onServingsChange).toHaveBeenCalledWith(null);
  });

  it("renders the current servings value", () => {
    const { getByTestId } = render({ servings: 2 });
    expect(getByTestId("recipe-create-servings").props.value).toBe("2");
  });

  it("fires onInstructionsChange", () => {
    const { getByTestId, props } = render();
    fireEvent.changeText(
      getByTestId("recipe-create-instructions"),
      "Step 1. Do it.",
    );
    expect(props.onInstructionsChange).toHaveBeenCalledWith("Step 1. Do it.");
  });

  it("Back button fires onBack", () => {
    const { getByTestId, props } = render();
    fireEvent.press(getByTestId("recipe-create-back"));
    expect(props.onBack).toHaveBeenCalledTimes(1);
  });

  it("Save is disabled when canSave is false", () => {
    const { getByTestId, props } = render({ canSave: false });
    fireEvent.press(getByTestId("recipe-create-save"));
    expect(props.onSave).not.toHaveBeenCalled();
  });

  it("Save fires onSave when canSave is true", () => {
    const { getByTestId, props } = render({ canSave: true });
    fireEvent.press(getByTestId("recipe-create-save"));
    expect(props.onSave).toHaveBeenCalledTimes(1);
  });

  it("shows Saving… while isSaving", () => {
    const { getByText } = render({ canSave: true, isSaving: true });
    expect(getByText("Saving…")).toBeTruthy();
  });

  it("renders an ingredient row with name/quantity/unit inputs", () => {
    const { getByTestId } = render({ rows: [row({ id: "row-0" })] });
    expect(getByTestId("recipe-create-row-row-0-name")).toBeTruthy();
    expect(getByTestId("recipe-create-row-row-0-quantity")).toBeTruthy();
    expect(getByTestId("recipe-create-row-row-0-unit")).toBeTruthy();
  });

  it("fires onChangeRowQuantity with a parsed number", () => {
    const { getByTestId, props } = render({ rows: [row({ id: "row-0" })] });
    fireEvent.changeText(
      getByTestId("recipe-create-row-row-0-quantity"),
      "200",
    );
    expect(props.onChangeRowQuantity).toHaveBeenCalledWith("row-0", 200);
  });

  it("fires onChangeRowQuantity with null for a non-numeric value", () => {
    const { getByTestId, props } = render({ rows: [row({ id: "row-0" })] });
    fireEvent.changeText(
      getByTestId("recipe-create-row-row-0-quantity"),
      "abc",
    );
    expect(props.onChangeRowQuantity).toHaveBeenCalledWith("row-0", null);
  });

  it("fires onChangeRowUnit", () => {
    const { getByTestId, props } = render({ rows: [row({ id: "row-0" })] });
    fireEvent.changeText(getByTestId("recipe-create-row-row-0-unit"), "tbsp");
    expect(props.onChangeRowUnit).toHaveBeenCalledWith("row-0", "tbsp");
  });

  it("fires onChangeRowName", () => {
    const { getByTestId, props } = render({ rows: [row({ id: "row-0" })] });
    fireEvent.changeText(
      getByTestId("recipe-create-row-row-0-name"),
      "Chicken",
    );
    expect(props.onChangeRowName).toHaveBeenCalledWith("row-0", "Chicken");
  });

  it("fires onRemoveRow", () => {
    const { getByTestId, props } = render({ rows: [row({ id: "row-0" })] });
    fireEvent.press(getByTestId("recipe-create-row-row-0-remove"));
    expect(props.onRemoveRow).toHaveBeenCalledWith("row-0");
  });

  it("fires onAddRow", () => {
    const { getByTestId, props } = render();
    fireEvent.press(getByTestId("recipe-create-add-row"));
    expect(props.onAddRow).toHaveBeenCalledTimes(1);
  });

  it("shows a linked pill + food name for a linked row (no Find-food affordance)", () => {
    const { getByTestId, queryByTestId, getByText } = render({
      rows: [row({ id: "row-0", foodId: "f1", foodName: "Chicken breast" })],
    });
    expect(getByText("Chicken breast")).toBeTruthy();
    expect(queryByTestId("recipe-create-row-row-0-find-food")).toBeNull();
    expect(getByTestId("recipe-create-row-row-0-remove")).toBeTruthy();
  });

  it("shows the Find-food affordance for an unlinked row and opens search on tap", () => {
    const { getByTestId, props } = render({ rows: [row({ id: "row-0" })] });
    fireEvent.press(getByTestId("recipe-create-row-row-0-find-food"));
    expect(props.onOpenRowSearch).toHaveBeenCalledWith("row-0");
  });

  it("renders search results and links a food on tap", () => {
    const { getByTestId, props } = render({
      rows: [row({ id: "row-0", name: "chick" })],
      activeSearchRowId: "row-0",
      searchQuery: "chick",
      searchResults: [searchFood],
    });
    fireEvent.press(getByTestId("recipe-create-row-row-0-result-f1"));
    expect(props.onLinkFood).toHaveBeenCalledWith("row-0", searchFood);
  });

  it("shows a searching indicator while isSearching", () => {
    const { getByText } = render({
      rows: [row({ id: "row-0" })],
      activeSearchRowId: "row-0",
      searchQuery: "ch",
      isSearching: true,
    });
    expect(getByText("Searching…")).toBeTruthy();
  });

  it("shows the Create-with-AI button when the search yields no matches", () => {
    const { getByTestId, props } = render({
      rows: [row({ id: "row-0", name: "Obscure Thing" })],
      activeSearchRowId: "row-0",
      searchQuery: "obscure thing",
      searchResults: [],
    });
    const btn = getByTestId("recipe-create-row-row-0-create-ai");
    expect(btn).toBeTruthy();
    fireEvent.press(btn);
    expect(props.onCreateWithAi).toHaveBeenCalledWith("row-0");
  });

  it("disables the Create-with-AI button while resolving", () => {
    const { getByText } = render({
      rows: [row({ id: "row-0", name: "Obscure Thing" })],
      activeSearchRowId: "row-0",
      searchQuery: "obscure thing",
      searchResults: [],
      resolvingRowId: "row-0",
    });
    expect(getByText("Creating…")).toBeTruthy();
  });

  it("shows a per-row AI failure message", () => {
    const { getByTestId } = render({
      rows: [row({ id: "row-0", name: "x" })],
      activeSearchRowId: "row-0",
      searchQuery: "x",
      rowMessages: { "row-0": "Daily AI limit reached." },
    });
    expect(getByTestId("recipe-create-row-row-0-message")).toBeTruthy();
  });

  it("closes the search box on Close", () => {
    const { getByTestId, props } = render({
      rows: [row({ id: "row-0" })],
      activeSearchRowId: "row-0",
      searchQuery: "x",
    });
    fireEvent.press(getByTestId("recipe-create-row-row-0-search-close"));
    expect(props.onCloseRowSearch).toHaveBeenCalledTimes(1);
  });

  it("shows the live macro total pills", () => {
    const { getByText } = render({
      macroTotal: { kcal: 640, proteinG: 55, carbsG: 70, fatG: 14 },
    });
    expect(getByText("640 KCAL")).toBeTruthy();
    expect(getByText("P 55G")).toBeTruthy();
    expect(getByText("C 70G")).toBeTruthy();
    expect(getByText("F 14G")).toBeTruthy();
  });

  it("shows the no-macros hint when no row is linked", () => {
    const { getByTestId } = render({
      rows: [row({ id: "row-0", foodId: null })],
    });
    expect(getByTestId("recipe-create-macro-hint")).toBeTruthy();
  });

  it("hides the no-macros hint once a row is linked", () => {
    const { queryByTestId } = render({
      rows: [row({ id: "row-0", foodId: "f1", foodName: "Chicken" })],
    });
    expect(queryByTestId("recipe-create-macro-hint")).toBeNull();
  });
});
