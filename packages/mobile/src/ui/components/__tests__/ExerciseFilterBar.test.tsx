import { fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import { ExerciseFilterBar } from "../ExerciseFilterBar";

function makeProps(
  overrides: Partial<Parameters<typeof ExerciseFilterBar>[0]> = {},
) {
  return {
    selectedQuickFilters: ["all"] as Parameters<
      typeof ExerciseFilterBar
    >[0]["selectedQuickFilters"],
    hasAdvancedFilters: false,
    onToggleQuickFilter: jest.fn(),
    onOpenFilterModal: jest.fn(),
    testID: "filter-bar",
    ...overrides,
  };
}

describe("ExerciseFilterBar", () => {
  it("renders the leading filter-modal trigger", () => {
    const { getByTestId } = renderWithTheme(
      <ExerciseFilterBar {...makeProps()} />,
    );
    expect(getByTestId("filter-modal-trigger")).toBeTruthy();
  });

  it("tints the trigger active only when advanced filters are set", () => {
    const { getByTestId, rerender } = renderWithTheme(
      <ExerciseFilterBar {...makeProps({ hasAdvancedFilters: false })} />,
    );
    expect(
      getByTestId("filter-modal-trigger").props.accessibilityState?.selected,
    ).toBe(false);

    rerender(
      <ExerciseFilterBar {...makeProps({ hasAdvancedFilters: true })} />,
    );
    expect(
      getByTestId("filter-modal-trigger").props.accessibilityState?.selected,
    ).toBe(true);
  });

  it("fires onOpenFilterModal when the trigger is pressed", () => {
    const onOpenFilterModal = jest.fn();
    const { getByTestId } = renderWithTheme(
      <ExerciseFilterBar {...makeProps({ onOpenFilterModal })} />,
    );
    fireEvent.press(getByTestId("filter-modal-trigger"));
    expect(onOpenFilterModal).toHaveBeenCalledTimes(1);
  });

  it("renders every curated quick-filter pill exactly once", () => {
    const { getByTestId } = renderWithTheme(
      <ExerciseFilterBar {...makeProps()} />,
    );
    for (const id of [
      "all",
      "mine",
      "system",
      "beginner",
      "intermediate",
      "advanced",
      "expert",
    ]) {
      expect(getByTestId(`quick-filter-${id}`)).toBeTruthy();
    }
  });

  it("marks selected quick-filter pills via accessibilityState.selected", () => {
    const { getByTestId } = renderWithTheme(
      <ExerciseFilterBar
        {...makeProps({
          selectedQuickFilters: ["beginner", "intermediate"],
        })}
      />,
    );
    expect(
      getByTestId("quick-filter-beginner").props.accessibilityState?.selected,
    ).toBe(true);
    expect(
      getByTestId("quick-filter-intermediate").props.accessibilityState
        ?.selected,
    ).toBe(true);
    expect(
      getByTestId("quick-filter-advanced").props.accessibilityState?.selected,
    ).toBe(false);
    expect(
      getByTestId("quick-filter-all").props.accessibilityState?.selected,
    ).toBe(false);
  });

  it("fires onToggleQuickFilter with the pill id on press", () => {
    const onToggleQuickFilter = jest.fn();
    const { getByTestId } = renderWithTheme(
      <ExerciseFilterBar {...makeProps({ onToggleQuickFilter })} />,
    );
    fireEvent.press(getByTestId("quick-filter-beginner"));
    expect(onToggleQuickFilter).toHaveBeenCalledWith("beginner");
    fireEvent.press(getByTestId("quick-filter-all"));
    expect(onToggleQuickFilter).toHaveBeenCalledWith("all");
  });
});
