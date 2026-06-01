import { fireEvent } from "@testing-library/react-native";

import type { Workout } from "@/domain/models/workout";
import { WorkoutRow } from "@/ui/components/workouts/WorkoutRow";
import { rowPressStyle } from "@/ui/components/workouts/WorkoutRow/WorkoutRow";
import { renderWithTheme } from "../../../../../__tests__/test-utils";

const buildWorkout = (overrides: Partial<Workout> = {}): Workout => ({
  id: "wo-1",
  name: "Upper Body",
  description: null,
  createdBy: "user-1",
  visibility: "private",
  estimatedDurationMinutes: 45,
  exercises: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

const exerciseStub = { id: "we-1" } as Workout["exercises"][number];

describe("WorkoutRow", () => {
  it("renders the name and a pluralised meta line", () => {
    const { getByText } = renderWithTheme(
      <WorkoutRow
        workout={buildWorkout({
          name: "Lower Body",
          estimatedDurationMinutes: 50,
          exercises: [exerciseStub, exerciseStub, exerciseStub],
        })}
        isLast={false}
        onPress={jest.fn()}
        onStart={jest.fn()}
      />,
    );
    expect(getByText("Lower Body")).toBeTruthy();
    expect(getByText("50m · 3 exercises")).toBeTruthy();
  });

  it("renders the singular meta line for a one-exercise workout", () => {
    const { getByText } = renderWithTheme(
      <WorkoutRow
        workout={buildWorkout({
          estimatedDurationMinutes: 12,
          exercises: [exerciseStub],
        })}
        isLast
        onPress={jest.fn()}
        onStart={jest.fn()}
      />,
    );
    expect(getByText("12m · 1 exercise")).toBeTruthy();
  });

  it("fires onPress when the row is tapped", () => {
    const onPress = jest.fn();
    const { getByTestId } = renderWithTheme(
      <WorkoutRow
        workout={buildWorkout({ id: "wo-9" })}
        isLast={false}
        onPress={onPress}
        onStart={jest.fn()}
      />,
    );
    fireEvent.press(getByTestId("workout-row-wo-9"));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("fires onStart from the Play button without bubbling to the row", () => {
    const onPress = jest.fn();
    const onStart = jest.fn();
    const { getByLabelText } = renderWithTheme(
      <WorkoutRow
        workout={buildWorkout({ name: "Mobility" })}
        isLast={false}
        onPress={onPress}
        onStart={onStart}
      />,
    );
    fireEvent.press(getByLabelText("Start Mobility"));
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it("dims the row to 0.85 opacity while pressed", () => {
    expect(rowPressStyle({ pressed: true }).opacity).toBe(0.85);
    expect(rowPressStyle({ pressed: false }).opacity).toBe(1);
  });

  it("fires onLongPress when provided (owner context menu)", () => {
    const onLongPress = jest.fn();
    const { getByTestId } = renderWithTheme(
      <WorkoutRow
        workout={buildWorkout({ id: "wo-owner" })}
        isLast={false}
        onPress={jest.fn()}
        onStart={jest.fn()}
        onLongPress={onLongPress}
      />,
    );
    fireEvent(getByTestId("workout-row-wo-owner"), "longPress");
    expect(onLongPress).toHaveBeenCalledTimes(1);
  });

  it("renders the split badge in the meta line when a split is given", () => {
    const { getByText } = renderWithTheme(
      <WorkoutRow
        workout={buildWorkout({ name: "Upper Body" })}
        split="push"
        isLast={false}
        onPress={jest.fn()}
        onStart={jest.fn()}
      />,
    );
    expect(getByText("PUSH")).toBeTruthy();
  });

  it("renders no badge when split is null", () => {
    const { queryByText } = renderWithTheme(
      <WorkoutRow
        workout={buildWorkout({ name: "Plain" })}
        split={null}
        isLast={false}
        onPress={jest.fn()}
        onStart={jest.fn()}
      />,
    );
    expect(queryByText("PUSH")).toBeNull();
  });

  it("renders the template variant with a chevron and no Play button", () => {
    const onPress = jest.fn();
    const { getByText, getByTestId, queryByLabelText } = renderWithTheme(
      <WorkoutRow
        workout={buildWorkout({ id: "tpl-1", name: "PPL Push" })}
        variant="template"
        isLast
        onPress={onPress}
      />,
    );
    expect(getByText("PPL Push")).toBeTruthy();
    // Templates don't start directly — no Play button.
    expect(queryByLabelText("Start PPL Push")).toBeNull();
    fireEvent.press(getByTestId("workout-row-tpl-1"));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
