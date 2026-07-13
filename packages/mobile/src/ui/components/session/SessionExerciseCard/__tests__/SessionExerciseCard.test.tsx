import { fireEvent } from "@testing-library/react-native";
import React from "react";
import { SessionExerciseCard } from "../SessionExerciseCard";
import { renderWithTheme } from "../../../../../../__tests__/test-utils";
import type { SessionExercise } from "@/domain/models/session";

const buildExercise = (
  overrides: Partial<SessionExercise> = {},
): SessionExercise => ({
  id: "se-1",
  sessionId: "s-1",
  exerciseId: "ex-bench",
  exerciseName: "Bench Press",
  sortOrder: 0,
  supersetGroup: null,
  isSubstituted: false,
  originalExerciseId: null,
  notes: null,
  sets: [
    {
      id: "set-1",
      sessionExerciseId: "se-1",
      setNumber: 1,
      weightKg: null,
      reps: null,
      rpe: null,
      durationSeconds: null,
      distanceMeters: null,
      isCompleted: false,
      completedAt: null,
    },
  ],
  ...overrides,
});

const baseHandlers = {
  onLogSet: jest.fn(),
  onUpdateSet: jest.fn(),
  onRemoveSet: jest.fn(),
  onOpenNotes: jest.fn(),
  onSubstitute: jest.fn(),
  onRemoveExercise: jest.fn(),
  onTapExercise: jest.fn(),
  onStartRest: jest.fn(),
};

describe("SessionExerciseCard", () => {
  beforeEach(() => {
    Object.values(baseHandlers).forEach((fn) => fn.mockClear?.());
  });

  it("renders the exercise name + a SetLogger per set", () => {
    const { getByText, getByTestId } = renderWithTheme(
      <SessionExerciseCard
        exercise={buildExercise()}
        previousSetsBySetNumber={{}}
        restSeconds={60}
        {...baseHandlers}
      />,
    );
    expect(getByText("Bench Press")).toBeTruthy();
    expect(getByTestId("session-exercise-se-1")).toBeTruthy();
    expect(getByTestId("set-logger-set-1")).toBeTruthy();
  });

  it("renders the column-header strip (SET / PREV / REPS / KG)", () => {
    const { getByText } = renderWithTheme(
      <SessionExerciseCard
        exercise={buildExercise()}
        previousSetsBySetNumber={{}}
        restSeconds={60}
        {...baseHandlers}
      />,
    );
    expect(getByText("SET")).toBeTruthy();
    expect(getByText("PREV")).toBeTruthy();
    expect(getByText("REPS")).toBeTruthy();
    expect(getByText("KG")).toBeTruthy();
  });

  it("renders the description line when targetSets + targetRepsMin/Max are supplied", () => {
    const { getByText } = renderWithTheme(
      <SessionExerciseCard
        exercise={buildExercise()}
        previousSetsBySetNumber={{}}
        restSeconds={60}
        targetSets={3}
        targetRepsMin={8}
        targetRepsMax={12}
        {...baseHandlers}
      />,
    );
    expect(getByText("3 sets × 8-12 reps")).toBeTruthy();
  });

  it("renders notes icon in primary colour when the exercise has notes", () => {
    const { getByTestId } = renderWithTheme(
      <SessionExerciseCard
        exercise={buildExercise({ notes: "Keep elbows tucked" })}
        previousSetsBySetNumber={{}}
        restSeconds={60}
        {...baseHandlers}
      />,
    );
    expect(getByTestId("session-exercise-notes")).toBeTruthy();
    // accessibility label flips to "Edit notes" when notes present.
    expect(getByTestId("session-exercise-notes").props.accessibilityLabel).toBe(
      "Edit notes",
    );
  });

  it("renders the {N} reps label when targetRepsMax is missing", () => {
    const { getByText } = renderWithTheme(
      <SessionExerciseCard
        exercise={buildExercise()}
        previousSetsBySetNumber={{}}
        restSeconds={60}
        targetSets={4}
        targetRepsMin={6}
        {...baseHandlers}
      />,
    );
    expect(getByText("4 sets × 6 reps")).toBeTruthy();
  });

  it("collapses min===max into a single rep count", () => {
    const { getByText } = renderWithTheme(
      <SessionExerciseCard
        exercise={buildExercise()}
        previousSetsBySetNumber={{}}
        restSeconds={60}
        targetSets={5}
        targetRepsMin={5}
        targetRepsMax={5}
        {...baseHandlers}
      />,
    );
    expect(getByText("5 sets × 5 reps")).toBeTruthy();
  });

  it("hides the description when target metadata is missing (Quick Start)", () => {
    const { queryByText } = renderWithTheme(
      <SessionExerciseCard
        exercise={buildExercise()}
        previousSetsBySetNumber={{}}
        restSeconds={90}
        {...baseHandlers}
      />,
    );
    // The description-line text would have a "sets ×" substring; nothing
    // matches when the line is not rendered.
    expect(queryByText(/sets ×/)).toBeNull();
  });

  it("renders the rest button labelled with the supplied rest seconds", () => {
    const onStartRest = jest.fn();
    const { getByText, getByTestId } = renderWithTheme(
      <SessionExerciseCard
        exercise={buildExercise()}
        previousSetsBySetNumber={{}}
        restSeconds={75}
        {...baseHandlers}
        onStartRest={onStartRest}
      />,
    );
    expect(getByText("75S REST")).toBeTruthy();
    fireEvent.press(getByTestId("session-exercise-start-rest"));
    expect(onStartRest).toHaveBeenCalled();
  });

  it("renders ADD SET copy and fires onLogSet on press", () => {
    const onLogSet = jest.fn();
    const { getByText, getByTestId } = renderWithTheme(
      <SessionExerciseCard
        exercise={buildExercise()}
        previousSetsBySetNumber={{}}
        restSeconds={60}
        {...baseHandlers}
        onLogSet={onLogSet}
      />,
    );
    expect(getByText("ADD SET")).toBeTruthy();
    fireEvent.press(getByTestId("session-exercise-add-set"));
    expect(onLogSet).toHaveBeenCalled();
  });

  it("renders an exercise thumbnail when exerciseImageUrl is supplied", () => {
    const { UNSAFE_getByType } = renderWithTheme(
      <SessionExerciseCard
        exercise={buildExercise()}
        previousSetsBySetNumber={{}}
        restSeconds={60}
        exerciseImageUrl="https://example.com/bench.png"
        {...baseHandlers}
      />,
    );
    // Image is the only Image element rendered when the URL is present.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Image } = require("react-native");
    expect(UNSAFE_getByType(Image).props.source).toEqual({
      uri: "https://example.com/bench.png",
    });
  });

  it("Substitute icon fires onSubstitute", () => {
    const onSubstitute = jest.fn();
    const { getByTestId } = renderWithTheme(
      <SessionExerciseCard
        exercise={buildExercise()}
        previousSetsBySetNumber={{}}
        restSeconds={60}
        {...baseHandlers}
        onSubstitute={onSubstitute}
      />,
    );
    fireEvent.press(getByTestId("session-exercise-substitute"));
    expect(onSubstitute).toHaveBeenCalled();
  });

  it("Notes icon fires onOpenNotes", () => {
    const onOpenNotes = jest.fn();
    const { getByTestId } = renderWithTheme(
      <SessionExerciseCard
        exercise={buildExercise()}
        previousSetsBySetNumber={{}}
        restSeconds={60}
        {...baseHandlers}
        onOpenNotes={onOpenNotes}
      />,
    );
    fireEvent.press(getByTestId("session-exercise-notes"));
    expect(onOpenNotes).toHaveBeenCalled();
  });

  it("Remove-exercise icon fires onRemoveExercise", () => {
    const onRemoveExercise = jest.fn();
    const { getByTestId } = renderWithTheme(
      <SessionExerciseCard
        exercise={buildExercise()}
        previousSetsBySetNumber={{}}
        restSeconds={60}
        {...baseHandlers}
        onRemoveExercise={onRemoveExercise}
      />,
    );
    fireEvent.press(getByTestId("session-exercise-remove"));
    expect(onRemoveExercise).toHaveBeenCalled();
  });

  it("Title tap fires onTapExercise", () => {
    const onTapExercise = jest.fn();
    const { getByTestId } = renderWithTheme(
      <SessionExerciseCard
        exercise={buildExercise()}
        previousSetsBySetNumber={{}}
        restSeconds={60}
        {...baseHandlers}
        onTapExercise={onTapExercise}
      />,
    );
    fireEvent.press(getByTestId("session-exercise-tap"));
    expect(onTapExercise).toHaveBeenCalled();
  });

  it("Trash icon on a set fires onRemoveSet with the set id", () => {
    const onRemoveSet = jest.fn();
    const { getByTestId } = renderWithTheme(
      <SessionExerciseCard
        exercise={buildExercise()}
        previousSetsBySetNumber={{}}
        restSeconds={60}
        {...baseHandlers}
        onRemoveSet={onRemoveSet}
      />,
    );
    fireEvent.press(getByTestId("set-logger-remove"));
    expect(onRemoveSet).toHaveBeenCalledWith("set-1");
  });

  it("Editing weight fires onUpdateSet with the set id", () => {
    const onUpdateSet = jest.fn();
    const { getByTestId } = renderWithTheme(
      <SessionExerciseCard
        exercise={buildExercise()}
        previousSetsBySetNumber={{}}
        restSeconds={60}
        {...baseHandlers}
        onUpdateSet={onUpdateSet}
      />,
    );
    fireEvent.changeText(getByTestId("set-logger-weight"), "100");
    expect(onUpdateSet).toHaveBeenCalledWith("set-1", { weightKg: 100 });
  });

  it("SetLogger fill-previous fires onUpdateSet with previous values", () => {
    const onUpdateSet = jest.fn();
    const { getByTestId } = renderWithTheme(
      <SessionExerciseCard
        exercise={buildExercise()}
        previousSetsBySetNumber={{ 1: { weightKg: 70, reps: 10 } }}
        restSeconds={60}
        {...baseHandlers}
        onUpdateSet={onUpdateSet}
      />,
    );
    fireEvent.press(getByTestId("set-logger-fill-previous"));
    expect(onUpdateSet).toHaveBeenCalledWith("set-1", {
      weightKg: 70,
      reps: 10,
    });
  });

  it("threads weightUnit='lb' into the column header + the previous-set chip (device-QA #8b)", () => {
    const { getByText, queryByText } = renderWithTheme(
      <SessionExerciseCard
        exercise={buildExercise()}
        previousSetsBySetNumber={{ 1: { weightKg: 70, reps: 10 } }}
        restSeconds={60}
        weightUnit="lb"
        {...baseHandlers}
      />,
    );
    expect(getByText("LB")).toBeTruthy();
    expect(queryByText("KG")).toBeNull();
    // 70 kg -> 154.3 lb (weightInUnit, 1dp).
    expect(getByText("10 reps • 154.3 lb")).toBeTruthy();
  });
});
