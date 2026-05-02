import { fireEvent } from "@testing-library/react-native";
import React from "react";
import { ExerciseConfigCard } from "@/ui/components/workouts/ExerciseConfigCard";
import { renderWithTheme } from "../../../../../__tests__/test-utils";

const baseExercise = {
  exercise_name: "Bench Press",
  target_sets: 3,
  target_reps_min: 8,
  target_reps_max: 12,
  rest_seconds: 90,
  superset_group: null,
};

describe("ExerciseConfigCard", () => {
  it("renders exercise name + index + initial values", () => {
    const { getByText, getByTestId } = renderWithTheme(
      <ExerciseConfigCard
        exercise={baseExercise}
        index={0}
        onRemove={jest.fn()}
        onConfigChange={jest.fn()}
      />,
    );
    expect(getByText("1")).toBeTruthy();
    expect(getByText("Bench Press")).toBeTruthy();
    expect(getByTestId("sets-input").props.value).toBe("3");
    expect(getByTestId("reps-min-input").props.value).toBe("8");
    expect(getByTestId("reps-max-input").props.value).toBe("12");
    expect(getByTestId("rest-input").props.value).toBe("90");
  });

  it("commits sets + reps + rest values on blur", () => {
    const onConfigChange = jest.fn();
    const { getByTestId } = renderWithTheme(
      <ExerciseConfigCard
        exercise={baseExercise}
        index={0}
        onRemove={jest.fn()}
        onConfigChange={onConfigChange}
      />,
    );

    fireEvent.changeText(getByTestId("sets-input"), "5");
    fireEvent(getByTestId("sets-input"), "blur");
    expect(onConfigChange).toHaveBeenCalledWith("target_sets", 5);

    fireEvent.changeText(getByTestId("reps-min-input"), "10");
    fireEvent(getByTestId("reps-min-input"), "blur");
    expect(onConfigChange).toHaveBeenCalledWith("target_reps_min", 10);

    fireEvent.changeText(getByTestId("reps-max-input"), "15");
    fireEvent(getByTestId("reps-max-input"), "blur");
    expect(onConfigChange).toHaveBeenCalledWith("target_reps_max", 15);

    fireEvent.changeText(getByTestId("rest-input"), "120");
    fireEvent(getByTestId("rest-input"), "blur");
    expect(onConfigChange).toHaveBeenCalledWith("rest_seconds", 120);
  });

  it("emits a 0 sentinel when a numeric field is cleared", () => {
    const onConfigChange = jest.fn();
    const { getByTestId } = renderWithTheme(
      <ExerciseConfigCard
        exercise={baseExercise}
        index={0}
        onRemove={jest.fn()}
        onConfigChange={onConfigChange}
      />,
    );

    fireEvent.changeText(getByTestId("sets-input"), "");
    fireEvent(getByTestId("sets-input"), "blur");
    expect(onConfigChange).toHaveBeenCalledWith("target_sets", 0);
  });

  it("disables shared fields on superset peer (non-lead)", () => {
    const lead = { ...baseExercise, target_sets: 4, rest_seconds: 60 };
    const peer = {
      ...baseExercise,
      exercise_name: "Incline Press",
      superset_group: 1,
    };
    const onConfigChange = jest.fn();
    const { getByTestId, getAllByText } = renderWithTheme(
      <ExerciseConfigCard
        exercise={peer}
        index={1}
        onRemove={jest.fn()}
        onConfigChange={onConfigChange}
        isSupersetEnd
        supersetLeadExercise={lead}
      />,
    );

    expect(getByTestId("sets-input").props.editable).toBe(false);
    expect(getByTestId("rest-input").props.editable).toBe(false);
    expect(getByTestId("sets-input").props.value).toBe("4");
    expect(getByTestId("rest-input").props.value).toBe("60");
    // Two "Inherited from superset" hints — sets + rest.
    expect(getAllByText("Inherited from superset").length).toBe(2);

    // Editing a disabled shared field is a no-op.
    fireEvent.changeText(getByTestId("sets-input"), "9");
    fireEvent(getByTestId("sets-input"), "blur");
    expect(onConfigChange).not.toHaveBeenCalledWith("target_sets", 9);
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
    expect(getByText("Superset 2")).toBeTruthy();
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
    expect(getByText("Superset 0")).toBeTruthy();
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
