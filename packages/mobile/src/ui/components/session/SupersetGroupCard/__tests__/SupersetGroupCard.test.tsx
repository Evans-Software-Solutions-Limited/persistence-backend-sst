import { fireEvent } from "@testing-library/react-native";
import React from "react";
import { SupersetGroupCard } from "../SupersetGroupCard";
import type { SessionExercise } from "@/domain/models/session";
import { renderWithTheme } from "../../../../../../__tests__/test-utils";

const buildExercise = (
  overrides: Partial<SessionExercise> = {},
): SessionExercise => ({
  id: "se-1",
  sessionId: "local-1",
  exerciseId: "ex-bench",
  exerciseName: "Bench Press",
  sortOrder: 0,
  supersetGroup: 1,
  isSubstituted: false,
  originalExerciseId: null,
  notes: null,
  sets: [],
  ...overrides,
});

const baseProps = {
  supersetGroup: 1,
  exercises: [
    buildExercise({ id: "se-A", exerciseId: "ex-bench" }),
    buildExercise({
      id: "se-B",
      exerciseId: "ex-row",
      exerciseName: "Row",
      sortOrder: 1,
    }),
  ],
  previousByExercise: {} as Record<
    string,
    { weightKg: number; reps: number } | null
  >,
  templateByExercise: {} as Record<
    string,
    {
      restSeconds: number;
      targetSets?: number;
      targetRepsMin?: number;
      targetRepsMax?: number;
      imageUrl?: string;
    }
  >,
  onLogSupersetSet: jest.fn(),
  onUpdateSet: jest.fn(),
  onRemoveSet: jest.fn(),
  onOpenNotes: jest.fn(),
  onSubstitute: jest.fn(),
  onRemoveExercise: jest.fn(),
  onTapExercise: jest.fn(),
  onStartRest: jest.fn(),
};

describe("SupersetGroupCard", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders a SUPERSET badge with the exercise + set counts", () => {
    const { getByText } = renderWithTheme(<SupersetGroupCard {...baseProps} />);
    expect(getByText(/SUPERSET · 2 EXERCISES · 0 SETS/)).toBeTruthy();
  });

  it("pluralises sets correctly when at least one exercise has sets", () => {
    const props = {
      ...baseProps,
      exercises: [
        buildExercise({
          id: "se-A",
          sets: [
            {
              id: "set-1",
              sessionExerciseId: "se-A",
              setNumber: 1,
              weightKg: 80,
              reps: 8,
              rpe: null,
              durationSeconds: null,
              distanceMeters: null,
              isCompleted: false,
              completedAt: null,
            },
          ],
        }),
        buildExercise({ id: "se-B", sortOrder: 1 }),
      ],
    };
    const { getByText } = renderWithTheme(<SupersetGroupCard {...props} />);
    expect(getByText(/1 SET\b/)).toBeTruthy();
  });

  it("renders an inner SessionExerciseCard for each peer", () => {
    const { getByTestId } = renderWithTheme(
      <SupersetGroupCard {...baseProps} />,
    );
    expect(getByTestId("session-exercise-se-A")).toBeTruthy();
    expect(getByTestId("session-exercise-se-B")).toBeTruthy();
  });

  it("Add paired set button fires onLogSupersetSet with every peer id", () => {
    const { getByTestId } = renderWithTheme(
      <SupersetGroupCard {...baseProps} />,
    );
    fireEvent.press(getByTestId("superset-1-add-set"));
    expect(baseProps.onLogSupersetSet).toHaveBeenCalledWith(["se-A", "se-B"]);
  });

  it("inner card's Add set button also fires onLogSupersetSet (paired logging — adding a set on one peer adds to all)", () => {
    const { getAllByTestId } = renderWithTheme(
      <SupersetGroupCard {...baseProps} />,
    );
    const innerAddButtons = getAllByTestId("session-exercise-add-set");
    fireEvent.press(innerAddButtons[0]);
    expect(baseProps.onLogSupersetSet).toHaveBeenCalledWith(["se-A", "se-B"]);
  });
});
