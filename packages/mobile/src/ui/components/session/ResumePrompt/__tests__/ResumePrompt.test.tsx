import { fireEvent } from "@testing-library/react-native";
import React from "react";
import { ResumePrompt } from "../ResumePrompt";
import type { WorkoutSession } from "@/domain/models/session";
import { renderWithTheme } from "../../../../../../__tests__/test-utils";

const session: WorkoutSession = {
  id: "local-1",
  userId: "user-1",
  workoutId: null,
  name: "Push Day",
  status: "in_progress",
  startedAt: "2026-05-05T10:00:00.000Z",
  completedAt: null,
  notes: null,
  exercises: [],
};

describe("ResumePrompt", () => {
  it("renders nothing when session is null (no in-progress session)", () => {
    const { queryByTestId } = renderWithTheme(
      <ResumePrompt
        session={null}
        onContinue={jest.fn()}
        onDiscard={jest.fn()}
        onDismiss={jest.fn()}
      />,
    );
    expect(queryByTestId("resume-prompt")).toBeNull();
  });

  it("renders the workout name in the prompt title", () => {
    const { getByText } = renderWithTheme(
      <ResumePrompt
        session={session}
        onContinue={jest.fn()}
        onDiscard={jest.fn()}
        onDismiss={jest.fn()}
      />,
    );
    expect(getByText("Continue Push Day?")).toBeTruthy();
  });

  it("Continue tap fires onContinue", () => {
    const onContinue = jest.fn();
    const { getByTestId } = renderWithTheme(
      <ResumePrompt
        session={session}
        onContinue={onContinue}
        onDiscard={jest.fn()}
        onDismiss={jest.fn()}
      />,
    );
    fireEvent.press(getByTestId("resume-prompt-continue"));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it("Discard tap fires onDiscard", () => {
    const onDiscard = jest.fn();
    const { getByTestId } = renderWithTheme(
      <ResumePrompt
        session={session}
        onContinue={jest.fn()}
        onDiscard={onDiscard}
        onDismiss={jest.fn()}
      />,
    );
    fireEvent.press(getByTestId("resume-prompt-discard"));
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });
});
