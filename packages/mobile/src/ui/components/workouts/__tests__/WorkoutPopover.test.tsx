import { fireEvent } from "@testing-library/react-native";
import React from "react";
import type { Workout } from "@/domain/models/workout";
import { WorkoutPopover } from "@/ui/components/workouts/WorkoutPopover";
import { renderWithTheme } from "../../../../../__tests__/test-utils";

const baseWorkout: Workout = {
  id: "w-1",
  name: "Push Day",
  description: "Hard upper-body session",
  createdBy: "test-user",
  visibility: "private",
  estimatedDurationMinutes: 60,
  exercises: [
    {
      id: "we-1",
      exerciseId: "ex-1",
      sortOrder: 0,
      supersetGroup: null,
      targetSets: 4,
      targetRepsMin: 8,
      targetRepsMax: 12,
      targetDurationSeconds: null,
      restSeconds: 90,
      notes: null,
      exercise: {
        id: "ex-1",
        name: "Bench Press",
        category: "strength",
        difficultyLevel: "intermediate",
        videoUrl: null,
        thumbnailUrl: null,
      },
    },
    {
      id: "we-2",
      exerciseId: "ex-2",
      sortOrder: 1,
      supersetGroup: 1,
      targetSets: 4,
      targetRepsMin: 6,
      targetRepsMax: 10,
      targetDurationSeconds: null,
      restSeconds: 90,
      notes: null,
      exercise: {
        id: "ex-2",
        name: "OHP",
        category: "strength",
        difficultyLevel: "intermediate",
        videoUrl: null,
        thumbnailUrl: null,
      },
    },
  ],
  createdAt: "2026-04-28T00:00:00Z",
  updatedAt: "2026-04-28T00:00:00Z",
};

describe("WorkoutPopover", () => {
  it("returns null when not visible", () => {
    const { queryByTestId } = renderWithTheme(
      <WorkoutPopover
        visible={false}
        workout={null}
        isLoading={false}
        error={null}
        onClose={() => {}}
        onStartWorkout={() => {}}
      />,
    );
    expect(queryByTestId("popover")).toBeNull();
  });

  it("renders the loading splash when isLoading is true", () => {
    const { getByText } = renderWithTheme(
      <WorkoutPopover
        visible={true}
        workout={null}
        isLoading={true}
        error={null}
        onClose={() => {}}
        onStartWorkout={() => {}}
      />,
    );
    expect(getByText("Loading workout details...")).toBeTruthy();
  });

  it("renders the error state when error is set", () => {
    const { getByText } = renderWithTheme(
      <WorkoutPopover
        visible={true}
        workout={null}
        isLoading={false}
        error={{ kind: "api", code: "network", message: "Bad connection" }}
        onClose={() => {}}
        onStartWorkout={() => {}}
      />,
    );
    expect(getByText("Failed to load workout")).toBeTruthy();
    expect(getByText("Bad connection")).toBeTruthy();
  });

  it("renders the workout name, description, metadata, exercise list, and superset badge", () => {
    const { getByText, getAllByText } = renderWithTheme(
      <WorkoutPopover
        visible={true}
        workout={baseWorkout}
        isLoading={false}
        error={null}
        onClose={() => {}}
        onStartWorkout={() => {}}
      />,
    );
    // Header (popover title) renders the workout name once; description
    // is the body copy. Both should appear.
    expect(getAllByText("Push Day").length).toBeGreaterThan(0);
    expect(getByText("Hard upper-body session")).toBeTruthy();
    expect(getByText("1h")).toBeTruthy();
    expect(getByText("2 exercises")).toBeTruthy();
    expect(getByText("Bench Press")).toBeTruthy();
    expect(getByText("OHP")).toBeTruthy();
    expect(getByText("Superset 1")).toBeTruthy();
    expect(getByText("4 sets × 8–12 reps")).toBeTruthy();
  });

  it("invokes onStartWorkout from the footer Start button", () => {
    const onStart = jest.fn();
    const { getByText } = renderWithTheme(
      <WorkoutPopover
        visible={true}
        workout={baseWorkout}
        isLoading={false}
        error={null}
        onClose={() => {}}
        onStartWorkout={onStart}
      />,
    );
    fireEvent.press(getByText("Start Workout"));
    expect(onStart).toHaveBeenCalledWith("w-1");
  });

  it("invokes onClose from the close button", () => {
    const onClose = jest.fn();
    const { getByTestId } = renderWithTheme(
      <WorkoutPopover
        visible={true}
        workout={baseWorkout}
        isLoading={false}
        error={null}
        onClose={onClose}
        onStartWorkout={() => {}}
      />,
    );
    fireEvent.press(getByTestId("close-button"));
    expect(onClose).toHaveBeenCalled();
  });
});
