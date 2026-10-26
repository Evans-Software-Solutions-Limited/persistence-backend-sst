import { fireEvent } from "@testing-library/react-native";
import React from "react";
import type { ExerciseSet, WorkoutSession } from "@/domain/models/session";
import { buildWorkoutSummary } from "@/domain/services/workoutSummary";
import { color } from "@/ui/theme/tokens";
import { WorkoutDetailsPresenter } from "../WorkoutDetailsPresenter";
import { renderWithTheme } from "../../../../__tests__/test-utils";

const set = (
  id: string,
  weightKg: number | null,
  reps: number | null,
): ExerciseSet => ({
  id,
  sessionExerciseId: "x",
  setNumber: 1,
  weightKg,
  reps,
  rpe: null,
  durationSeconds: null,
  distanceMeters: null,
  isCompleted: true,
  completedAt: null,
});

const session: WorkoutSession = {
  id: "local-1",
  userId: "u1",
  workoutId: null,
  name: "Lower Body B",
  status: "completed",
  startedAt: "2026-10-23T12:00:00.000Z",
  completedAt: "2026-10-23T12:52:08.000Z",
  notes: null,
  exercises: [
    {
      id: "se-1",
      sessionId: "local-1",
      exerciseId: "squat",
      exerciseName: "Barbell Back Squat",
      sortOrder: 0,
      supersetGroup: null,
      isSubstituted: false,
      originalExerciseId: null,
      notes: null,
      sets: [set("a", 60, 8), set("b", 65, 7)],
    },
    {
      id: "se-2",
      sessionId: "local-1",
      exerciseId: "lunge",
      exerciseName: "Walking Lunge",
      sortOrder: 1,
      supersetGroup: null,
      isSubstituted: false,
      originalExerciseId: null,
      notes: "Left knee a bit sore on the last set",
      sets: [set("c", null, 12), set("d", 20, 12)],
    },
  ],
};

const model = buildWorkoutSummary(session, 3128, [
  {
    exerciseId: "squat",
    exerciseName: "Barbell Back Squat",
    recordType: "max_weight",
    newValue: 65,
    previousValue: 62.5,
    setId: "b",
  },
]);

describe("WorkoutDetailsPresenter", () => {
  it("shows the header line, the totals strip and every set", () => {
    const onBack = jest.fn();
    const q = renderWithTheme(
      <WorkoutDetailsPresenter
        model={model}
        recordsCount={1}
        rating={8}
        partners={["Brad", "Tom", "Inés"]}
        onBack={onBack}
      />,
    );
    expect(q.getByText("Lower Body B")).toBeTruthy();
    expect(
      q.getByText("52:08 · 23 Oct · Hard 8/10 · with Brad, Tom, Inés"),
    ).toBeTruthy();
    expect(q.getByText("Sets")).toBeTruthy();
    expect(q.getByText("Records")).toBeTruthy();
    expect(q.getByText("Left knee a bit sore on the last set")).toBeTruthy();
    // The record set is gold with a star; a set without weight shows a dash.
    const star = q.getByText("65 kg ★");
    expect(JSON.stringify(star.props.style)).toContain(color.$gold);
    expect(q.getByText("60 kg")).toBeTruthy();
    expect(q.getAllByText("—").length).toBeGreaterThanOrEqual(2);
    // Epley 1RM, rounded: 60 × (1 + 8/30) = 76.
    expect(q.getByText("76")).toBeTruthy();
    expect(q.getByText("935 kg")).toBeTruthy();
    expect(q.getByText("240 kg")).toBeTruthy();
    fireEvent.press(q.getByTestId("workout-details-back"));
    expect(onBack).toHaveBeenCalled();
  });

  it("leaves out what it does not know, and converts to pounds", () => {
    const q = renderWithTheme(
      <WorkoutDetailsPresenter
        model={model}
        recordsCount={0}
        rating={null}
        weightUnit="lb"
        onBack={jest.fn()}
      />,
    );
    expect(q.getByText("52:08 · 23 Oct")).toBeTruthy();
    expect(q.getByText("132.3 lb")).toBeTruthy();
    expect(q.queryByText(/with /)).toBeNull();
  });
});
