import { fireEvent } from "@testing-library/react-native";
import React from "react";
import { ExerciseConfigCard } from "@/ui/components/workouts/ExerciseConfigCard";
import { formatRest } from "@/ui/components/workouts/ExerciseConfigCard/ExerciseConfigCard";
import { renderWithTheme } from "../../../../../__tests__/test-utils";

/** An exercise saved before PER-139: only the old range. */
const baseExercise = {
  exercise_name: "Bench Press",
  target_sets: 3,
  target_reps_min: 8,
  target_reps_max: 12,
  rest_seconds: 90,
  superset_group: null,
  set_reps: null,
};

/** 10 / 8 / 8 per set. */
const perSetExercise = {
  ...baseExercise,
  target_sets: 3,
  target_reps_min: 8,
  target_reps_max: 10,
  set_reps: [10, 8, 8],
};

describe("ExerciseConfigCard", () => {
  it("renders the name, index and each set's reps stepper (C5f)", () => {
    const { getByText, getByTestId, getByLabelText } = renderWithTheme(
      <ExerciseConfigCard
        exercise={perSetExercise}
        index={0}
        onRemove={jest.fn()}
        onConfigChange={jest.fn()}
      />,
    );
    expect(getByText("1")).toBeTruthy();
    expect(getByText("Bench Press")).toBeTruthy();
    expect(getByText("Set 1")).toBeTruthy();
    expect(getByText("Set 3")).toBeTruthy();
    expect(getByTestId("set-0-reps").props.children).toBe("10");
    expect(getByTestId("set-1-reps").props.children).toBe("8");
    expect(getByTestId("set-2-reps").props.children).toBe("8");
    expect(getByLabelText("Fewer reps, set 1")).toBeTruthy();
    expect(getByLabelText("More reps, set 3")).toBeTruthy();
    expect(getByTestId("rest-value").props.children).toBe("1:30");
    expect(getByText("Add set")).toBeTruthy();
    expect(getByText("Same reps for all")).toBeTruthy();
  });

  it("shows an old range on every set until a set's reps change", () => {
    const onSetReps = jest.fn();
    const { getByTestId } = renderWithTheme(
      <ExerciseConfigCard
        exercise={baseExercise}
        index={0}
        onRemove={jest.fn()}
        onConfigChange={jest.fn()}
        onSetReps={onSetReps}
      />,
    );
    expect(getByTestId("set-0-reps").props.children).toBe("8–12");
    expect(getByTestId("set-2-reps").props.children).toBe("8–12");
    // Steps from the top of the range.
    fireEvent.press(getByTestId("set-1-dec"));
    expect(onSetReps).toHaveBeenCalledWith(1, 11);
    fireEvent.press(getByTestId("set-0-inc"));
    expect(onSetReps).toHaveBeenCalledWith(0, 13);
  });

  it("wires the reps steppers, Add set, remove set and Same reps for all", () => {
    const onSetReps = jest.fn();
    const onAddSet = jest.fn();
    const onRemoveSet = jest.fn();
    const onSameRepsForAll = jest.fn();
    const { getByTestId } = renderWithTheme(
      <ExerciseConfigCard
        exercise={perSetExercise}
        index={0}
        onRemove={jest.fn()}
        onConfigChange={jest.fn()}
        onSetReps={onSetReps}
        onAddSet={onAddSet}
        onRemoveSet={onRemoveSet}
        onSameRepsForAll={onSameRepsForAll}
      />,
    );
    fireEvent.press(getByTestId("set-0-inc"));
    expect(onSetReps).toHaveBeenCalledWith(0, 11);
    fireEvent.press(getByTestId("set-2-dec"));
    expect(onSetReps).toHaveBeenCalledWith(2, 7);
    fireEvent.press(getByTestId("add-set"));
    expect(onAddSet).toHaveBeenCalledTimes(1);
    fireEvent.press(getByTestId("set-1-remove"));
    expect(onRemoveSet).toHaveBeenCalledWith(1);
    fireEvent.press(getByTestId("same-reps"));
    expect(onSameRepsForAll).toHaveBeenCalledTimes(1);
  });

  it("keeps reps within 1–100 and sets within 1–20", () => {
    const { getByTestId, queryByTestId } = renderWithTheme(
      <ExerciseConfigCard
        exercise={{
          ...perSetExercise,
          set_reps: [1, 100],
          target_reps_min: 1,
          target_reps_max: 100,
          target_sets: 2,
        }}
        index={0}
        onRemove={jest.fn()}
        onConfigChange={jest.fn()}
      />,
    );
    expect(getByTestId("set-0-dec").props.accessibilityState).toMatchObject({
      disabled: true,
    });
    expect(getByTestId("set-1-inc").props.accessibilityState).toMatchObject({
      disabled: true,
    });
    expect(queryByTestId("set-0-remove")).toBeTruthy();

    const twenty = Array.from({ length: 20 }, () => 5);
    const full = renderWithTheme(
      <ExerciseConfigCard
        exercise={{ ...perSetExercise, set_reps: twenty, target_sets: 20 }}
        index={0}
        onRemove={jest.fn()}
        onConfigChange={jest.fn()}
      />,
    );
    expect(full.getByTestId("add-set").props.accessibilityState).toMatchObject({
      disabled: true,
    });
  });

  it("offers no remove on a single set, and no Same reps for all", () => {
    const { queryByTestId, getByTestId } = renderWithTheme(
      <ExerciseConfigCard
        exercise={{ ...perSetExercise, set_reps: [10], target_sets: 1 }}
        index={0}
        onRemove={jest.fn()}
        onConfigChange={jest.fn()}
      />,
    );
    expect(queryByTestId("set-0-remove")).toBeNull();
    expect(getByTestId("same-reps").props.accessibilityState).toMatchObject({
      disabled: true,
    });
  });

  it("steps rest by 15 seconds and floors it at 0:00", () => {
    const onConfigChange = jest.fn();
    const { getByTestId, rerender } = renderWithTheme(
      <ExerciseConfigCard
        exercise={perSetExercise}
        index={0}
        onRemove={jest.fn()}
        onConfigChange={onConfigChange}
      />,
    );
    fireEvent.press(getByTestId("rest-inc"));
    expect(onConfigChange).toHaveBeenCalledWith("rest_seconds", 105);
    fireEvent.press(getByTestId("rest-dec"));
    expect(onConfigChange).toHaveBeenCalledWith("rest_seconds", 75);

    rerender(
      <ExerciseConfigCard
        exercise={{ ...perSetExercise, rest_seconds: 10 }}
        index={0}
        onRemove={jest.fn()}
        onConfigChange={onConfigChange}
      />,
    );
    fireEvent.press(getByTestId("rest-dec"));
    expect(onConfigChange).toHaveBeenLastCalledWith("rest_seconds", 0);
  });

  it("collapses to the summary line and expands again", () => {
    const onToggle = jest.fn();
    const { getByTestId, queryByTestId, getByLabelText, rerender } =
      renderWithTheme(
        <ExerciseConfigCard
          exercise={perSetExercise}
          index={0}
          onRemove={jest.fn()}
          onConfigChange={jest.fn()}
          expanded={false}
          onToggleExpanded={onToggle}
        />,
      );
    expect(getByTestId("set-summary").props.children).toBe("3 sets · 10, 8, 8");
    expect(queryByTestId("set-row-0")).toBeNull();
    fireEvent.press(getByLabelText("Expand Bench Press"));
    fireEvent.press(getByTestId("exercise-header"));
    expect(onToggle).toHaveBeenCalledTimes(2);

    rerender(
      <ExerciseConfigCard
        exercise={baseExercise}
        index={0}
        onRemove={jest.fn()}
        onConfigChange={jest.fn()}
        expanded={false}
        onToggleExpanded={onToggle}
      />,
    );
    expect(getByTestId("set-summary").props.children).toBe(
      "3 sets · 8–12 reps",
    );
  });

  it("shows last time's weights as a hint, and Save's error", () => {
    const { getByTestId } = renderWithTheme(
      <ExerciseConfigCard
        exercise={perSetExercise}
        index={0}
        onRemove={jest.fn()}
        onConfigChange={jest.fn()}
        lastTimeHint="Last time 92.5 kg × 8, 6, 6, 5"
        error="Use 1 to 20 sets."
      />,
    );
    expect(getByTestId("last-time-hint").props.children).toBe(
      "Last time 92.5 kg × 8, 6, 6, 5",
    );
    expect(getByTestId("exercise-error").props.children).toBe(
      "Use 1 to 20 sets.",
    );
  });

  it("superset peer (non-lead): shares the lead's rest and set count", () => {
    const onConfigChange = jest.fn();
    const onAddSet = jest.fn();
    const { getByTestId, getAllByText, queryByTestId } = renderWithTheme(
      <ExerciseConfigCard
        exercise={{ ...perSetExercise, superset_group: 1, rest_seconds: 30 }}
        index={1}
        onRemove={jest.fn()}
        onConfigChange={onConfigChange}
        onAddSet={onAddSet}
        isSupersetEnd
        supersetLeadExercise={{ ...perSetExercise, rest_seconds: 60 }}
      />,
    );
    expect(getByTestId("rest-value").props.children).toBe("1:00");
    expect(getAllByText("Inherited from superset").length).toBe(1);
    expect(getByTestId("add-set").props.accessibilityState).toMatchObject({
      disabled: true,
    });
    expect(queryByTestId("set-0-remove")).toBeNull();
    fireEvent.press(getByTestId("add-set"));
    fireEvent.press(getByTestId("rest-inc"));
    expect(onAddSet).not.toHaveBeenCalled();
    expect(onConfigChange).not.toHaveBeenCalled();
    // Each member still sets its own reps per set.
    expect(getByTestId("set-0-inc").props.accessibilityState).toMatchObject({
      disabled: false,
    });
  });

  it("formats rest as m:ss", () => {
    expect(formatRest(150)).toBe("2:30");
    expect(formatRest(60)).toBe("1:00");
    expect(formatRest(5)).toBe("0:05");
    expect(formatRest(-3)).toBe("0:00");
  });

  it("renders the superset badge on the lead row", () => {
    const { getByText } = renderWithTheme(
      <ExerciseConfigCard
        exercise={{ ...baseExercise, superset_group: 2 }}
        index={0}
        onRemove={jest.fn()}
        onConfigChange={jest.fn()}
        isSupersetStart
        supersetGroupNumber={2}
      />,
    );
    expect(getByText("SUPERSET 2")).toBeTruthy();
  });

  it("renders the superset letter pill when a letter is supplied", () => {
    const { getByText } = renderWithTheme(
      <ExerciseConfigCard
        exercise={{ ...baseExercise, superset_group: 5 }}
        index={0}
        onRemove={jest.fn()}
        onConfigChange={jest.fn()}
        isSupersetStart
        supersetGroupNumber={5}
        supersetLetter="B"
      />,
    );
    expect(getByText("SUPERSET B")).toBeTruthy();
  });

  it("renders the superset badge correctly when group number is 0", () => {
    // Falsy-but-valid case: a zero-indexed superset group from the
    // server should still render the badge — the legacy
    // `{supersetGroupNumber && ...}` pattern silently rendered the
    // string "0" as a bare text node here.
    const { getByText, queryByText } = renderWithTheme(
      <ExerciseConfigCard
        exercise={{ ...baseExercise, superset_group: 0 }}
        index={0}
        onRemove={jest.fn()}
        onConfigChange={jest.fn()}
        isSupersetStart
        supersetGroupNumber={0}
      />,
    );
    expect(getByText("SUPERSET 0")).toBeTruthy();
    // No bare "0" text node leaking from a falsy-conditional.
    expect(queryByText("0", { exact: true })).toBeNull();
  });

  it("invokes onRemove when the trash button is pressed", () => {
    const onRemove = jest.fn();
    const { getByTestId } = renderWithTheme(
      <ExerciseConfigCard
        exercise={baseExercise}
        index={0}
        onRemove={onRemove}
        onConfigChange={jest.fn()}
      />,
    );
    fireEvent.press(getByTestId("remove-button"));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });
});
