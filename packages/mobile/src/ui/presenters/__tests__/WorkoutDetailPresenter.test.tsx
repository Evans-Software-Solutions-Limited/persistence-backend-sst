import { fireEvent } from "@testing-library/react-native";
import React from "react";
import type { Workout } from "@/domain/models/workout";
import { WorkoutDetailPresenter } from "@/ui/presenters/WorkoutDetailPresenter";
import { renderWithTheme } from "../../../../__tests__/test-utils";

const buildWorkout = (overrides: Partial<Workout> = {}): Workout => ({
  id: "w-1",
  name: "Push Day",
  description: "Heavy chest session",
  createdBy: "user-1",
  visibility: "private",
  estimatedDurationMinutes: 60,
  showInOwnerLibrary: overrides.showInOwnerLibrary ?? true,
  exercises: [],
  createdAt: "2026-04-28T00:00:00Z",
  updatedAt: "2026-04-28T00:00:00Z",
  ...overrides,
});

describe("WorkoutDetailPresenter", () => {
  it("renders loading state when isLoading and no workout", () => {
    const { getByTestId } = renderWithTheme(
      <WorkoutDetailPresenter
        workout={null}
        isLoading={true}
        error={null}
        onClose={jest.fn()}
        onStartWorkout={jest.fn()}
        onExercisePress={jest.fn()}
      />,
    );
    expect(getByTestId("workout-detail-loading")).toBeTruthy();
  });

  it("renders error state with message when error and no workout", () => {
    const { getByTestId, getByText } = renderWithTheme(
      <WorkoutDetailPresenter
        workout={null}
        isLoading={false}
        error={{
          kind: "api",
          code: "not_found",
          message: "It broke somehow",
        }}
        onClose={jest.fn()}
        onStartWorkout={jest.fn()}
        onExercisePress={jest.fn()}
      />,
    );
    expect(getByTestId("workout-detail-error")).toBeTruthy();
    expect(getByText("It broke somehow")).toBeTruthy();
  });

  it("formats hours-and-minutes durations correctly (>=60 minutes)", () => {
    const { getByText } = renderWithTheme(
      <WorkoutDetailPresenter
        workout={buildWorkout({ estimatedDurationMinutes: 95 })}
        isLoading={false}
        error={null}
        onClose={jest.fn()}
        onStartWorkout={jest.fn()}
        onExercisePress={jest.fn()}
      />,
    );
    expect(getByText("1h 35m")).toBeTruthy();
  });

  it("formats whole-hours durations without minutes", () => {
    const { getByText } = renderWithTheme(
      <WorkoutDetailPresenter
        workout={buildWorkout({ estimatedDurationMinutes: 120 })}
        isLoading={false}
        error={null}
        onClose={jest.fn()}
        onStartWorkout={jest.fn()}
        onExercisePress={jest.fn()}
      />,
    );
    expect(getByText("2h")).toBeTruthy();
  });

  it("renders exercise rows with thumbnail + superset badge + category meta", () => {
    const workout = buildWorkout({
      exercises: [
        {
          id: "we-1",
          exerciseId: "ex-bench",
          sortOrder: 1,
          supersetGroup: 1,
          targetSets: 4,
          targetRepsMin: 8,
          targetRepsMax: 12,
          targetDurationSeconds: null,
          restSeconds: 90,
          notes: null,
          exercise: {
            id: "ex-bench",
            name: "Bench Press",
            category: "strength",
            difficultyLevel: "intermediate",
            videoUrl: null,
            thumbnailUrl: "https://cdn/example.jpg",
          },
        },
      ],
    });
    const { getByText } = renderWithTheme(
      <WorkoutDetailPresenter
        workout={workout}
        isLoading={false}
        error={null}
        onClose={jest.fn()}
        onStartWorkout={jest.fn()}
        onExercisePress={jest.fn()}
      />,
    );
    expect(getByText("Bench Press")).toBeTruthy();
    expect(getByText("Superset 1")).toBeTruthy();
    expect(getByText("strength • intermediate")).toBeTruthy();
  });

  it("renders exercise rows without joined exercise (no thumbnail, no category)", () => {
    const workout = buildWorkout({
      exercises: [
        {
          id: "we-2",
          exerciseId: "ex-orphan",
          sortOrder: 1,
          supersetGroup: null,
          targetSets: 3,
          targetRepsMin: 10,
          targetRepsMax: 15,
          targetDurationSeconds: null,
          restSeconds: 60,
          notes: null,
          exercise: null,
        },
      ],
    });
    const { getByText, queryByText } = renderWithTheme(
      <WorkoutDetailPresenter
        workout={workout}
        isLoading={false}
        error={null}
        onClose={jest.fn()}
        onStartWorkout={jest.fn()}
        onExercisePress={jest.fn()}
      />,
    );
    expect(getByText("Exercise")).toBeTruthy();
    // No superset badge.
    expect(queryByText(/Superset/)).toBeNull();
  });

  it("hides description block when workout.description is null", () => {
    const { queryByText } = renderWithTheme(
      <WorkoutDetailPresenter
        workout={buildWorkout({ description: null })}
        isLoading={false}
        error={null}
        onClose={jest.fn()}
        onStartWorkout={jest.fn()}
        onExercisePress={jest.fn()}
      />,
    );
    expect(queryByText("Heavy chest session")).toBeNull();
  });

  it("invokes callbacks on back / start / exercise tap", () => {
    const workout = buildWorkout({
      exercises: [
        {
          id: "we-1",
          exerciseId: "ex-bench",
          sortOrder: 1,
          supersetGroup: null,
          targetSets: 3,
          targetRepsMin: 8,
          targetRepsMax: 12,
          targetDurationSeconds: null,
          restSeconds: 60,
          notes: null,
          exercise: {
            id: "ex-bench",
            name: "Bench Press",
            category: "strength",
            difficultyLevel: "intermediate",
            videoUrl: null,
            thumbnailUrl: null,
          },
        },
      ],
    });
    const onClose = jest.fn();
    const onStartWorkout = jest.fn();
    const onExercisePress = jest.fn();
    const { getByTestId } = renderWithTheme(
      <WorkoutDetailPresenter
        workout={workout}
        isLoading={false}
        error={null}
        onClose={onClose}
        onStartWorkout={onStartWorkout}
        onExercisePress={onExercisePress}
      />,
    );
    fireEvent.press(getByTestId("workout-detail-back"));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.press(getByTestId("workout-detail-start"));
    expect(onStartWorkout).toHaveBeenCalledWith("w-1");

    fireEvent.press(getByTestId("workout-detail-exercise-ex-bench"));
    expect(onExercisePress).toHaveBeenCalledWith("ex-bench");
  });
});
