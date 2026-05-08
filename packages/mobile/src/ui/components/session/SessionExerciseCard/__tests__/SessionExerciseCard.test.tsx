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
};

describe("SessionExerciseCard", () => {
  beforeEach(() => {
    Object.values(baseHandlers).forEach((fn) => fn.mockClear?.());
  });

  it("renders the exercise name + progress + a SetLogger per set", () => {
    const { getByText, getByTestId } = renderWithTheme(
      <SessionExerciseCard
        exercise={buildExercise()}
        previous={null}
        {...baseHandlers}
      />,
    );
    expect(getByText("Bench Press")).toBeTruthy();
    expect(getByTestId("session-exercise-se-1")).toBeTruthy();
    expect(getByTestId("set-logger-set-1")).toBeTruthy();
  });

  it("shows the QuickFillSuggestion when previous is supplied and a set is empty", () => {
    const { queryByTestId } = renderWithTheme(
      <SessionExerciseCard
        exercise={buildExercise()}
        previous={{ weightKg: 80, reps: 8 }}
        {...baseHandlers}
      />,
    );
    expect(queryByTestId("quickfill-suggestion")).toBeTruthy();
  });

  it("Tapping QuickFillSuggestion fills the first empty set with previous weight + reps", () => {
    const onUpdateSet = jest.fn();
    const { getByTestId } = renderWithTheme(
      <SessionExerciseCard
        exercise={buildExercise({
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
        })}
        previous={{ weightKg: 100, reps: 5 }}
        {...baseHandlers}
        onUpdateSet={onUpdateSet}
      />,
    );
    fireEvent.press(getByTestId("quickfill-suggestion"));
    expect(onUpdateSet).toHaveBeenCalledWith("set-1", {
      weightKg: 100,
      reps: 5,
    });
  });

  it("Tapping the inner SetLogger's fill-previous button forwards weight + reps to onUpdateSet", () => {
    const onUpdateSet = jest.fn();
    const { getAllByTestId } = renderWithTheme(
      <SessionExerciseCard
        exercise={buildExercise({
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
        })}
        previous={{ weightKg: 90, reps: 7 }}
        {...baseHandlers}
        onUpdateSet={onUpdateSet}
      />,
    );
    const fills = getAllByTestId("set-logger-fill-previous");
    fireEvent.press(fills[0]);
    expect(onUpdateSet).toHaveBeenCalledWith("set-1", {
      weightKg: 90,
      reps: 7,
    });
  });

  it("hides the QuickFillSuggestion when no empty sets exist", () => {
    const { queryByTestId } = renderWithTheme(
      <SessionExerciseCard
        exercise={buildExercise({
          sets: [
            {
              id: "set-1",
              sessionExerciseId: "se-1",
              setNumber: 1,
              weightKg: 80,
              reps: 8,
              rpe: null,
              durationSeconds: null,
              distanceMeters: null,
              isCompleted: true,
              completedAt: "ts",
            },
          ],
        })}
        previous={{ weightKg: 80, reps: 8 }}
        {...baseHandlers}
      />,
    );
    expect(queryByTestId("quickfill-suggestion")).toBeNull();
  });

  it("renders the Substituted badge when isSubstituted=true", () => {
    const { getByText } = renderWithTheme(
      <SessionExerciseCard
        exercise={buildExercise({ isSubstituted: true })}
        previous={null}
        {...baseHandlers}
      />,
    );
    expect(getByText("Substituted")).toBeTruthy();
  });

  it("Add set button fires onLogSet", () => {
    const onLogSet = jest.fn();
    const { getByTestId } = renderWithTheme(
      <SessionExerciseCard
        exercise={buildExercise()}
        previous={null}
        {...baseHandlers}
        onLogSet={onLogSet}
      />,
    );
    fireEvent.press(getByTestId("session-exercise-add-set"));
    expect(onLogSet).toHaveBeenCalled();
  });

  it("Substitute icon fires onSubstitute", () => {
    const onSubstitute = jest.fn();
    const { getByTestId } = renderWithTheme(
      <SessionExerciseCard
        exercise={buildExercise()}
        previous={null}
        {...baseHandlers}
        onSubstitute={onSubstitute}
      />,
    );
    fireEvent.press(getByTestId("session-exercise-substitute"));
    expect(onSubstitute).toHaveBeenCalled();
  });

  it("Header tap fires onTapExercise (M2 learning #11)", () => {
    const onTapExercise = jest.fn();
    const { getByTestId } = renderWithTheme(
      <SessionExerciseCard
        exercise={buildExercise()}
        previous={null}
        {...baseHandlers}
        onTapExercise={onTapExercise}
      />,
    );
    fireEvent.press(getByTestId("session-exercise-tap"));
    expect(onTapExercise).toHaveBeenCalled();
  });

  it("QuickFillSuggestion press fills the empty set via onUpdateSet", () => {
    const onUpdateSet = jest.fn();
    const { getByTestId } = renderWithTheme(
      <SessionExerciseCard
        exercise={buildExercise()}
        previous={{ weightKg: 80, reps: 8 }}
        {...baseHandlers}
        onUpdateSet={onUpdateSet}
      />,
    );
    fireEvent.press(getByTestId("quickfill-suggestion"));
    expect(onUpdateSet).toHaveBeenCalledWith("set-1", {
      weightKg: 80,
      reps: 8,
    });
  });

  it("Trash icon on any set fires onRemoveSet with the set id", () => {
    const onRemoveSet = jest.fn();
    const { getByTestId } = renderWithTheme(
      <SessionExerciseCard
        exercise={buildExercise()}
        previous={null}
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
        previous={null}
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
        previous={{ weightKg: 70, reps: 10 }}
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
});
