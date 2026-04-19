import { fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import { ExerciseFilterBar } from "../ExerciseFilterBar";

jest.mock("@expo/vector-icons", () => {
  const { Text } = jest.requireActual("react-native");
  const Ionicons = ({ name }: { name: string }) => (
    <Text testID={`icon-${name}`}>{name}</Text>
  );
  return { Ionicons };
});

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
  it("renders the leading filter-modal trigger with the options icon", () => {
    const { getByTestId } = renderWithTheme(
      <ExerciseFilterBar {...makeProps()} />,
    );
    expect(getByTestId("filter-modal-trigger")).toBeTruthy();
    expect(getByTestId("icon-options-outline")).toBeTruthy();
  });

  it("shows the active dot on the trigger only when advanced filters are set", () => {
    const { queryByTestId, rerender } = renderWithTheme(
      <ExerciseFilterBar {...makeProps({ hasAdvancedFilters: false })} />,
    );
    expect(queryByTestId("filter-modal-trigger-dot")).toBeNull();

    rerender(
      <ExerciseFilterBar {...makeProps({ hasAdvancedFilters: true })} />,
    );
    expect(queryByTestId("filter-modal-trigger-dot")).toBeTruthy();
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
