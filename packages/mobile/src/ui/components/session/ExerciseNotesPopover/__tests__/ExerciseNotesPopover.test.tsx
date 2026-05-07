import { fireEvent } from "@testing-library/react-native";
import React from "react";
import { ExerciseNotesPopover } from "../ExerciseNotesPopover";
import { renderWithTheme } from "../../../../../../__tests__/test-utils";

const baseProps = {
  visible: true,
  exerciseName: "Bench Press",
  initialNotes: "",
  onSave: jest.fn(),
  onCancel: jest.fn(),
};

describe("ExerciseNotesPopover", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders nothing when visible=false (no Modal mount in test tree)", () => {
    const { queryByTestId } = renderWithTheme(
      <ExerciseNotesPopover {...baseProps} visible={false} />,
    );
    expect(queryByTestId("exercise-notes-popover")).toBeNull();
  });

  it("renders the exercise name and the initial notes value", () => {
    const { getByText, getByTestId } = renderWithTheme(
      <ExerciseNotesPopover
        {...baseProps}
        exerciseName="Incline Press"
        initialNotes="elbows in"
      />,
    );
    expect(getByText("Incline Press")).toBeTruthy();
    expect(getByTestId("exercise-notes-input").props.value).toBe("elbows in");
  });

  it("Save trims trailing whitespace and forwards the result", () => {
    const onSave = jest.fn();
    const { getByTestId } = renderWithTheme(
      <ExerciseNotesPopover {...baseProps} onSave={onSave} initialNotes="" />,
    );
    fireEvent.changeText(getByTestId("exercise-notes-input"), "  go heavy  ");
    fireEvent.press(getByTestId("exercise-notes-save"));
    expect(onSave).toHaveBeenCalledWith("go heavy");
  });

  it("renders an empty input when initialNotes is omitted (default param)", () => {
    const { getByTestId } = renderWithTheme(
      <ExerciseNotesPopover
        visible={true}
        exerciseName="Bench Press"
        onSave={jest.fn()}
        onCancel={jest.fn()}
      />,
    );
    expect(getByTestId("exercise-notes-input").props.value).toBe("");
  });

  it("Cancel resets local state and forwards onCancel", () => {
    const onCancel = jest.fn();
    const onSave = jest.fn();
    const { getByTestId } = renderWithTheme(
      <ExerciseNotesPopover
        {...baseProps}
        onCancel={onCancel}
        onSave={onSave}
        initialNotes="initial"
      />,
    );
    fireEvent.changeText(getByTestId("exercise-notes-input"), "edited");
    fireEvent.press(getByTestId("exercise-notes-cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });
});
