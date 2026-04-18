import { fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import { ExerciseFilterBar } from "../ExerciseFilterBar";

function makeProps(
  overrides: Partial<Parameters<typeof ExerciseFilterBar>[0]> = {},
) {
  return {
    category: null,
    difficulty: null,
    equipment: [],
    hasActiveFilters: false,
    onSelectCategory: jest.fn(),
    onSelectDifficulty: jest.fn(),
    onToggleEquipment: jest.fn(),
    onClearFilters: jest.fn(),
    testID: "filter-bar",
    ...overrides,
  };
}

describe("ExerciseFilterBar", () => {
  it("renders chips for every category, difficulty, and equipment option", () => {
    const { getByTestId } = renderWithTheme(
      <ExerciseFilterBar {...makeProps()} />,
    );
    expect(getByTestId("filter-category-strength")).toBeTruthy();
    expect(getByTestId("filter-category-mobility")).toBeTruthy();
    expect(getByTestId("filter-difficulty-beginner")).toBeTruthy();
    expect(getByTestId("filter-difficulty-expert")).toBeTruthy();
    expect(getByTestId("filter-equipment-barbell")).toBeTruthy();
    expect(getByTestId("filter-equipment-other")).toBeTruthy();
  });

  it("does not show clear-all button when no filters are active", () => {
    const { queryByTestId } = renderWithTheme(
      <ExerciseFilterBar {...makeProps({ hasActiveFilters: false })} />,
    );
    expect(queryByTestId("filter-bar-clear")).toBeNull();
  });

  it("shows clear-all button when filters are active and fires callback", () => {
    const onClearFilters = jest.fn();
    const { getByTestId } = renderWithTheme(
      <ExerciseFilterBar
        {...makeProps({ hasActiveFilters: true, onClearFilters })}
      />,
    );
    fireEvent.press(getByTestId("filter-bar-clear"));
    expect(onClearFilters).toHaveBeenCalledTimes(1);
  });

  it("selects a new category on press", () => {
    const onSelectCategory = jest.fn();
    const { getByTestId } = renderWithTheme(
      <ExerciseFilterBar {...makeProps({ onSelectCategory })} />,
    );
    fireEvent.press(getByTestId("filter-category-strength"));
    expect(onSelectCategory).toHaveBeenCalledWith("strength");
  });

  it("clears category when the active chip is pressed again", () => {
    const onSelectCategory = jest.fn();
    const { getByTestId } = renderWithTheme(
      <ExerciseFilterBar
        {...makeProps({ category: "strength", onSelectCategory })}
      />,
    );
    fireEvent.press(getByTestId("filter-category-strength"));
    expect(onSelectCategory).toHaveBeenCalledWith(null);
  });

  it("selects a new difficulty on press", () => {
    const onSelectDifficulty = jest.fn();
    const { getByTestId } = renderWithTheme(
      <ExerciseFilterBar {...makeProps({ onSelectDifficulty })} />,
    );
    fireEvent.press(getByTestId("filter-difficulty-advanced"));
    expect(onSelectDifficulty).toHaveBeenCalledWith("advanced");
  });

  it("clears difficulty when the active chip is pressed again", () => {
    const onSelectDifficulty = jest.fn();
    const { getByTestId } = renderWithTheme(
      <ExerciseFilterBar
        {...makeProps({ difficulty: "advanced", onSelectDifficulty })}
      />,
    );
    fireEvent.press(getByTestId("filter-difficulty-advanced"));
    expect(onSelectDifficulty).toHaveBeenCalledWith(null);
  });

  it("toggles equipment chips independently", () => {
    const onToggleEquipment = jest.fn();
    const { getByTestId } = renderWithTheme(
      <ExerciseFilterBar
        {...makeProps({ equipment: ["barbell"], onToggleEquipment })}
      />,
    );
    fireEvent.press(getByTestId("filter-equipment-dumbbell"));
    expect(onToggleEquipment).toHaveBeenCalledWith("dumbbell");
    fireEvent.press(getByTestId("filter-equipment-barbell"));
    expect(onToggleEquipment).toHaveBeenCalledWith("barbell");
  });

  it("renders active chips with selected accessibility state", () => {
    const { getByTestId } = renderWithTheme(
      <ExerciseFilterBar
        {...makeProps({
          category: "strength",
          difficulty: "intermediate",
          equipment: ["barbell"],
          hasActiveFilters: true,
        })}
      />,
    );
    expect(
      getByTestId("filter-category-strength").props.accessibilityState
        ?.selected,
    ).toBe(true);
    expect(
      getByTestId("filter-difficulty-intermediate").props.accessibilityState
        ?.selected,
    ).toBe(true);
    expect(
      getByTestId("filter-equipment-barbell").props.accessibilityState
        ?.selected,
    ).toBe(true);
    expect(
      getByTestId("filter-equipment-cable").props.accessibilityState?.selected,
    ).toBe(false);
  });
});
