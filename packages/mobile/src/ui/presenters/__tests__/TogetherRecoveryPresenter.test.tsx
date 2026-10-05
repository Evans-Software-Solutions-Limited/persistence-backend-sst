import React from "react";
import { fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import {
  TogetherRecoveryPresenter,
  type TogetherRecoveryPresenterProps,
} from "../TogetherRecoveryPresenter";
import type { TogetherWorkoutReview } from "@/domain/ports/togetherWorkout.port";
function review(
  status: TogetherWorkoutReview["status"] = "stored_for_review",
): TogetherWorkoutReview {
  return {
    status,
    sharingActive: false,
    historySaved: status === "saved",
    sessionId: "session",
    executionId: "own",
    revision: 4,
    startedAt: 1,
    snapshotToken: "token",
    omissions: ["Notes", "RPE"],
    plan: {
      name: "Push",
      exercises: [
        {
          planExerciseId: "p",
          exerciseId: "original",
          order: 0,
          targetSets: 2,
        },
      ],
    },
    execution: {
      exercises: [
        {
          planExerciseId: "p",
          substituteExerciseId: "sub",
          skipped: false,
          sets: [
            { setId: "complete", reps: 5, weightKg: 20, completed: true },
            { setId: "draft", reps: 10, weightKg: 100, completed: false },
          ],
        },
        {
          planExerciseId: "skip",
          skipped: true,
          sets: [
            { setId: "skipped-set", reps: 99, weightKg: 500, completed: true },
          ],
        },
      ],
    },
  };
}
function props(): TogetherRecoveryPresenterProps {
  return {
    name: "Push",
    review: null,
    busy: false,
    available: true,
    error: "",
    exerciseNames: { sub: "Dumbbell press" },
    onReview: jest.fn(),
    onSave: jest.fn(),
    onBack: jest.fn(),
    onDone: jest.fn(),
  };
}
it("keeps unuploaded work local and disables unavailable or busy operations", () => {
  const p = props(),
    r = renderWithTheme(<TogetherRecoveryPresenter {...p} available={false} />);
  expect(
    r.getByText(/without sharing or renewing a subscription/),
  ).toBeTruthy();
  fireEvent.press(r.getByText("Review my result"));
  expect(p.onReview).not.toHaveBeenCalled();
  r.rerender(<TogetherRecoveryPresenter {...p} busy />);
  fireEvent.press(r.getByText("Working…"));
  expect(p.onReview).not.toHaveBeenCalled();
  r.rerender(<TogetherRecoveryPresenter {...p} />);
  fireEvent.press(r.getByText("Review my result"));
  expect(p.onReview).toHaveBeenCalledTimes(1);
  fireEvent.press(r.getByText("Back"));
  expect(p.onBack).toHaveBeenCalledTimes(1);
});
it("shows completed own sets and explicit local omissions without counting skipped or incomplete sets", () => {
  const p = { ...props(), review: review() },
    r = renderWithTheme(<TogetherRecoveryPresenter {...p} />);
  expect(r.getByText("1 completed sets · 100 kg")).toBeTruthy();
  expect(r.getByText("Dumbbell press")).toBeTruthy();
  expect(r.getByText("Exercise · skipped")).toBeTruthy();
  expect(r.getByText("Set 1 · 5 reps · 20 kg")).toBeTruthy();
  expect(r.queryByText(/99 reps/)).toBeNull();
  expect(r.queryByText(/10 reps/)).toBeNull();
  expect(r.getByText("Kept on this device: Notes")).toBeTruthy();
  expect(r.getByText("Kept on this device: RPE")).toBeTruthy();
  expect(
    r.getByText(/Nothing is saved to workout history until you confirm/),
  ).toBeTruthy();
  fireEvent.press(r.getByText("Refresh review"));
  fireEvent.press(r.getByText("Save reviewed result"));
  expect(p.onReview).toHaveBeenCalledTimes(1);
  expect(p.onSave).toHaveBeenCalledTimes(1);
});
it.each(["saved", "finished_empty"] as const)(
  "distinguishes confirmed %s from a review or peer receipt",
  (status) => {
    const p = {
        ...props(),
        review: { ...review(status), effectsPending: status === "saved" },
      },
      r = renderWithTheme(<TogetherRecoveryPresenter {...p} />);
    expect(
      r.getByText(status === "saved" ? "Workout saved" : "Workout finished"),
    ).toBeTruthy();
    expect(r.queryByText("Save reviewed result")).toBeNull();
    expect(r.queryByText("Review my result")).toBeNull();
    if (status === "saved")
      expect(
        r.getByText(/Records and statistics are still updating/),
      ).toBeTruthy();
    else
      expect(
        r.getByText("No completed sets were saved to history."),
      ).toBeTruthy();
    fireEvent.press(r.getByText("Continue"));
    expect(p.onDone).toHaveBeenCalledTimes(1);
  },
);
it("uses the original exercise name, safe unknown fallback and actionable error", () => {
  const p = {
    ...props(),
    review: review(),
    error: "Please refresh",
    exerciseNames: { original: "Bench" },
  };
  p.review.execution.exercises[0].substituteExerciseId = null;
  const r = renderWithTheme(<TogetherRecoveryPresenter {...p} />);
  expect(r.getByText("Bench")).toBeTruthy();
  expect(r.getByText("Please refresh").props.accessibilityRole).toBe("alert");
  p.review.execution.exercises[0].planExerciseId = "unmapped";
  r.rerender(<TogetherRecoveryPresenter {...p} />);
  expect(r.getByText("Exercise")).toBeTruthy();
});
