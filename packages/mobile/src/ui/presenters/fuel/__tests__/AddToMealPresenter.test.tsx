import { fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../../__tests__/test-utils";
import { AddToMealPresenter, type AddToMealProps } from "../AddToMealPresenter";

const quick = {
  aiLocked: false,
  snapOffline: false,
  suggestLocked: false,
  onScan: jest.fn(),
  onSnap: jest.fn(),
  onSearch: jest.fn(),
  onQuickLog: jest.fn(),
  onSuggest: jest.fn(),
};

function render(over: Partial<AddToMealProps> = {}) {
  const props: AddToMealProps = {
    mealName: "Pre-workout",
    onBack: jest.fn(),
    quickActions: quick,
    tab: "recent",
    onTab: jest.fn(),
    recentGroups: [
      {
        key: "g1",
        heading: "Yesterday · Pre-workout",
        rows: [
          {
            key: "e:1",
            name: "Oats",
            sub: "1 serving",
            kcal: 599,
            selected: true,
          },
          { key: "e:2", name: "Yoghurt", sub: "", kcal: 86, selected: false },
        ],
      },
    ],
    savedRows: [
      {
        key: "m:1",
        name: "Bagel breakfast",
        sub: "Saved meal",
        kcal: 526,
        selected: false,
      },
    ],
    recipeRows: [],
    onToggle: jest.fn(),
    onAddAll: jest.fn(),
    addLabel: "Add 1 item · 599 kcal",
    canAdd: true,
    adding: false,
    onAdd: jest.fn(),
    ...over,
  };
  return { ...renderWithTheme(<AddToMealPresenter {...props} />), props };
}

describe("AddToMealPresenter (full page)", () => {
  it("puts the meal name at the top, then the five quick buttons", () => {
    const { getByTestId, getByText } = render();
    expect(getByText("Add to Pre-workout")).toBeTruthy();
    for (const k of ["scan", "snap", "search", "quick-log", "suggest"]) {
      fireEvent.press(getByTestId(`add-to-meal-quick-${k}`));
    }
    expect(quick.onScan).toHaveBeenCalled();
    expect(quick.onSnap).toHaveBeenCalled();
    expect(quick.onSearch).toHaveBeenCalled();
    expect(quick.onQuickLog).toHaveBeenCalled();
    expect(quick.onSuggest).toHaveBeenCalled();
  });

  it("shows Recent grouped by day and meal, with Add all and ticks", () => {
    const { getByText, getByTestId, props } = render();
    expect(getByText("Yesterday · Pre-workout")).toBeTruthy();
    fireEvent.press(getByTestId("add-group-all-g1"));
    expect(props.onAddAll).toHaveBeenCalledWith("g1");
    fireEvent.press(getByTestId("add-row-e:2"));
    expect(props.onToggle).toHaveBeenCalledWith("e:2");
    expect(getByTestId("add-row-e:1").props.accessibilityState.checked).toBe(
      true,
    );
  });

  it("switches to Saved meals and Recipes, with empty states", () => {
    const { getByTestId, getByText, props, rerender } = render({
      tab: "saved",
    });
    expect(getByText("Bagel breakfast")).toBeTruthy();
    fireEvent.press(getByTestId("add-to-meal-tab-recipes"));
    expect(props.onTab).toHaveBeenCalledWith("recipes");
    rerender(<AddToMealPresenter {...props} tab="recipes" />);
    expect(getByText("No recipes yet.")).toBeTruthy();
    rerender(<AddToMealPresenter {...props} tab="recent" recentGroups={[]} />);
    expect(getByText("Nothing logged on earlier days yet.")).toBeTruthy();
  });

  it("adds the picked items and goes back", () => {
    const { getByTestId, getByText, props } = render();
    expect(getByText("Add 1 item · 599 kcal")).toBeTruthy();
    fireEvent.press(getByTestId("add-to-meal-add"));
    fireEvent.press(getByTestId("add-to-meal-back"));
    expect(props.onAdd).toHaveBeenCalled();
    expect(props.onBack).toHaveBeenCalled();
  });

  it("disables Add until something is picked", () => {
    const { getByTestId } = render({
      canAdd: false,
      addLabel: "Pick what to add",
    });
    expect(
      getByTestId("add-to-meal-add").props.accessibilityState.disabled,
    ).toBe(true);
  });
});
