import { fireEvent } from "@testing-library/react-native";

import { renderWithTheme } from "../../../../../__tests__/test-utils";
import {
  HabitTile,
  type HabitState,
  type HabitTone,
  habitTilePressStyle,
} from "../HabitTile";

const STATES: HabitState[] = ["done", "today", "missed", "locked"];
const TONES: HabitTone[] = ["primary", "gold", "trainer", "ember", "success"];

describe("HabitTile", () => {
  it.each(STATES)("renders the %s state", (state) => {
    const { getByTestId } = renderWithTheme(
      <HabitTile state={state} tone="primary" testID="tile" />,
    );
    expect(getByTestId("tile")).toBeTruthy();
  });

  it.each(TONES)("renders the done state for tone %s", (tone) => {
    const { getByTestId } = renderWithTheme(
      <HabitTile state="done" tone={tone} testID="tile" />,
    );
    expect(getByTestId("tile")).toBeTruthy();
  });

  it("fires onPress for an interactive (non-locked) tile", () => {
    const onPress = jest.fn();
    const { getByTestId } = renderWithTheme(
      <HabitTile
        state="today"
        tone="primary"
        onPress={onPress}
        testID="tile"
      />,
    );
    expect(getByTestId("tile").props.accessibilityRole).toBe("button");
    fireEvent.press(getByTestId("tile"));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("never becomes interactive when locked, even with onPress", () => {
    const onPress = jest.fn();
    const { getByTestId } = renderWithTheme(
      <HabitTile
        state="locked"
        tone="primary"
        onPress={onPress}
        testID="tile"
      />,
    );
    expect(getByTestId("tile").props.accessibilityRole).toBeUndefined();
    expect(getByTestId("tile").props.accessibilityState.disabled).toBe(true);
  });

  it("reflects the done state via accessibilityState.selected", () => {
    const { getByTestId } = renderWithTheme(
      <HabitTile
        state="done"
        tone="success"
        onPress={() => undefined}
        testID="tile"
      />,
    );
    expect(getByTestId("tile").props.accessibilityState.selected).toBe(true);
  });

  it("composes an accessibilityLabel from label + state", () => {
    const { getByTestId } = renderWithTheme(
      <HabitTile state="missed" tone="gold" label="Workout" testID="tile" />,
    );
    expect(getByTestId("tile").props.accessibilityLabel).toBe(
      "Workout: missed",
    );
  });

  it("honours an explicit accessibilityLabel", () => {
    const { getByTestId } = renderWithTheme(
      <HabitTile
        state="done"
        tone="primary"
        accessibilityLabel="Workout done today"
        testID="tile"
      />,
    );
    expect(getByTestId("tile").props.accessibilityLabel).toBe(
      "Workout done today",
    );
  });

  it("press style toggles opacity", () => {
    expect(habitTilePressStyle({ pressed: true }).opacity).toBe(0.7);
    expect(habitTilePressStyle({ pressed: false }).opacity).toBe(1);
  });
});
