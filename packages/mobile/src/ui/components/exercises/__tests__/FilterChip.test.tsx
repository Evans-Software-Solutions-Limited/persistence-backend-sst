import { fireEvent } from "@testing-library/react-native";

import { FilterChip } from "@/ui/components/exercises/FilterChip";
import { chipPressStyle } from "@/ui/components/exercises/FilterChip/FilterChip";
import { renderWithTheme } from "../../../../../__tests__/test-utils";

describe("FilterChip", () => {
  it("renders its label", () => {
    const { getByText } = renderWithTheme(
      <FilterChip onPress={jest.fn()}>Chest</FilterChip>,
    );
    expect(getByText("Chest")).toBeTruthy();
  });

  it("fires onPress when tapped", () => {
    const onPress = jest.fn();
    const { getByText } = renderWithTheme(
      <FilterChip onPress={onPress}>All</FilterChip>,
    );
    fireEvent.press(getByText("All"));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("exposes selected a11y state when active", () => {
    const { getByTestId } = renderWithTheme(
      <FilterChip active onPress={jest.fn()} testID="chip-mine">
        Mine
      </FilterChip>,
    );
    expect(getByTestId("chip-mine").props.accessibilityState).toMatchObject({
      selected: true,
    });
  });

  it("is not selected when inactive", () => {
    const { getByTestId } = renderWithTheme(
      <FilterChip onPress={jest.fn()} testID="chip-all">
        All
      </FilterChip>,
    );
    expect(getByTestId("chip-all").props.accessibilityState).toMatchObject({
      selected: false,
    });
  });

  it("dims to 0.85 opacity while pressed (never shrinks)", () => {
    expect(chipPressStyle({ pressed: true })).toMatchObject({
      opacity: 0.85,
      flexShrink: 0,
    });
    expect(chipPressStyle({ pressed: false }).opacity).toBe(1);
  });
});
