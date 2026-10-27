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
    const onShare = jest.fn();
    const q = renderWithTheme(
      <WorkoutDetailsPresenter
        model={model}
        recordsCount={1}
        rating={8}
        partners={["Brad", "Tom", "Inés"]}
        onBack={onBack}
        onShare={onShare}
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
    fireEvent.press(q.getByTestId("workout-details-share"));
    expect(onShare).toHaveBeenCalledWith(
      [
        "Lower Body B · 23 Oct · 52 min",
        "1,175 kg · 4 sets · 39 reps",
        "Barbell Back Squat: 60×8, 65×7",
        "Walking Lunge: 12, 20×12",
        "Logged with Persistence",
      ].join("\n"),
    );
  });

  it("leaves out what it does not know, and converts to pounds", () => {
    const q = renderWithTheme(
      <WorkoutDetailsPresenter
        model={model}
        recordsCount={0}
        rating={null}
        weightUnit="lb"
        onBack={jest.fn()}
        onShare={jest.fn()}
      />,
    );
    expect(q.getByText("52:08 · 23 Oct")).toBeTruthy();
    expect(q.getByText("132.3 lb")).toBeTruthy();
    expect(q.queryByText(/with /)).toBeNull();
  });

  it("shows time and distance for a run or a row instead of dashes", () => {
    const cardio = (
      id: string,
      durationSeconds: number | null,
      distanceMeters: number | null,
    ) => ({ ...set(id, null, null), durationSeconds, distanceMeters });
    const exercise = (
      id: string,
      name: string,
      sets: ExerciseSet[],
    ): WorkoutSession["exercises"][number] => ({
      ...session.exercises[0]!,
      id,
      exerciseId: id,
      exerciseName: name,
      notes: null,
      sets,
    });
    const run = buildWorkoutSummary(
      {
        ...session,
        exercises: [
          exercise("se-run", "Run", [
            cardio("r1", 600, 2000),
            cardio("r2", 330, null),
          ]),
          exercise("se-plank", "Plank", [cardio("p1", 60, null)]),
        ],
      },
      1200,
    );
    const q = renderWithTheme(
      <WorkoutDetailsPresenter
        model={run}
        recordsCount={0}
        rating={null}
        onBack={jest.fn()}
        onShare={jest.fn()}
      />,
    );
    const runCard = q.getByTestId("workout-details-exercise-se-run");
    const text = (node: typeof runCard) =>
      q
        .getAllByText(/./)
        .filter((t) => isInside(t, node))
        .map((t) => t.props.children)
        .filter((c) => typeof c === "string");
    expect(text(runCard)).toEqual(
      expect.arrayContaining([
        "Time",
        "Distance",
        "10:00",
        "2.0 km",
        "5:30",
        "—",
      ]),
    );
    expect(text(runCard)).not.toContain("Weight");
    expect(text(runCard)).not.toContain("0 kg");
    const plank = q.getByTestId("workout-details-exercise-se-plank");
    expect(text(plank)).toEqual(expect.arrayContaining(["1:00"]));
    expect(text(runCard).some((c) => c.includes("★"))).toBe(false);
  });

  it("stars a cardio record in gold: the fastest timed distance", () => {
    const cardio = (
      id: string,
      durationSeconds: number,
      distanceMeters: number,
    ) => ({
      ...set(id, null, null),
      durationSeconds,
      distanceMeters,
    });
    const model = buildWorkoutSummary(
      {
        ...session,
        exercises: [
          {
            ...session.exercises[0]!,
            id: "se-run",
            exerciseId: "run",
            exerciseName: "Run",
            notes: null,
            sets: [cardio("slow", 900, 3000), cardio("fast", 600, 3000)],
          },
        ],
      },
      1500,
      [
        {
          exerciseId: "run",
          exerciseName: "Run",
          recordType: "best_time",
          newValue: 600,
          previousValue: 640,
          setId: "server-id",
        },
      ],
    );
    const q = renderWithTheme(
      <WorkoutDetailsPresenter
        model={model}
        recordsCount={1}
        rating={null}
        onBack={jest.fn()}
        onShare={jest.fn()}
      />,
    );
    const star = q.getByText("10:00 ★");
    expect(JSON.stringify(star.props.style)).toContain(color.$gold);
    expect(q.getByText("15:00")).toBeTruthy();
  });
});

function isInside(node: { parent: unknown }, root: unknown): boolean {
  let n = node.parent as { parent: unknown } | null;
  while (n) {
    if (n === root) return true;
    n = n.parent as { parent: unknown } | null;
  }
  return false;
}
