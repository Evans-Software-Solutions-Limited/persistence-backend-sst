import React from "react";
import { fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import { TogetherJoinConsentPresenter } from "../TogetherJoinConsentPresenter";
import { TogetherJoiningPresenter } from "../TogetherJoiningPresenter";
const base = {
  hostName: "Brad Evans",
  workoutName: "Lower Body B",
  memberCount: 3,
  faces: ["Brad Evans", "Tom Vance", "Inés Marco"],
  connection: "local" as const,
  onBack: jest.fn(),
  onJoin: jest.fn(),
};
it("Join this workout shows the session, the mode and the three consent lines", () => {
  const r = renderWithTheme(<TogetherJoinConsentPresenter {...base} />);
  expect(r.getByText("Brad’s session")).toBeTruthy();
  expect(r.getByText("Join this workout")).toBeTruthy();
  expect(r.getByText("Lower Body B")).toBeTruthy();
  expect(r.getByText("3 of 4")).toBeTruthy();
  expect(r.getByText("Nearby · no internet needed")).toBeTruthy();
  expect(
    r.getByText(/They see your name, photo and the sets you log here/),
  ).toBeTruthy();
  expect(r.getByText(/Nobody sees your history/)).toBeTruthy();
  expect(r.getByText("Joining starts your workout on this plan.")).toBeTruthy();
  expect(r.queryByText(/Opened from/)).toBeNull();
  fireEvent.press(r.getByText("Join and start"));
  fireEvent.press(r.getByLabelText("Back"));
  expect(base.onJoin).toHaveBeenCalledTimes(1);
  expect(base.onBack).toHaveBeenCalledTimes(1);
});
it("shows the host's plan and when they started (PER-60)", () => {
  const now = Date.parse("2026-10-23T12:00:00Z");
  const r = renderWithTheme(
    <TogetherJoinConsentPresenter
      {...base}
      startedAt={now - 18 * 60_000}
      now={now}
      plan={[
        { name: "Barbell Back Squat", sets: 4, reps: 6 },
        { name: "Walking Lunge", sets: 3, reps: null },
      ]}
    />,
  );
  expect(r.getByText("3 of 4 · started 18 minutes ago")).toBeTruthy();
  expect(r.getByText("The plan")).toBeTruthy();
  expect(r.getAllByTestId("together-plan-row")).toHaveLength(2);
  expect(r.getByText("Barbell Back Squat")).toBeTruthy();
  expect(r.getByText("4 × 6")).toBeTruthy();
  expect(r.getByText("3 sets")).toBeTruthy();
  r.rerender(
    <TogetherJoinConsentPresenter
      {...base}
      memberCount={undefined}
      plan={[]}
    />,
  );
  expect(r.queryByText("The plan")).toBeNull();
  expect(r.queryByText(/of 4/)).toBeNull();
});
it("a cold start says where it came from; a non-partner asks the host; online names internet", () => {
  const r = renderWithTheme(
    <TogetherJoinConsentPresenter
      {...base}
      hostName="Kai Anand"
      connection="online"
      cold
      requiresApproval
      memberCount={undefined}
      faces={undefined}
      notice="Try again"
      busy
    />,
  );
  expect(r.getByText(/Opened from Kai’s QR/)).toBeTruthy();
  expect(r.getByText("Ask Kai and start")).toBeTruthy();
  expect(r.getByText("Online · internet required")).toBeTruthy();
  expect(r.getByText("Try again")).toBeTruthy();
  expect(r.queryByText(/of 4/)).toBeNull();
});
it("Joining shows connecting, then waiting for a non-partner host, and cancels", () => {
  const onCancel = jest.fn();
  const r = renderWithTheme(
    <TogetherJoiningPresenter
      hostName="Brad Evans"
      connection="local"
      step="connect"
      onCancel={onCancel}
    />,
  );
  expect(r.getByText("Connecting to Brad’s phone")).toBeTruthy();
  expect(
    r.getByText(/Keep Wi-Fi on. This can take up to 30 seconds/),
  ).toBeTruthy();
  expect(r.getByText("Found Brad’s session")).toBeTruthy();
  expect(r.getByText("Checking it is really Brad")).toBeTruthy();
  expect(r.getByText("Start your workout")).toBeTruthy();
  fireEvent.press(r.getByText("Cancel"));
  expect(onCancel).toHaveBeenCalledTimes(1);
  r.rerender(
    <TogetherJoiningPresenter
      hostName="Kai Anand"
      connection="online"
      step="ask"
      onCancel={onCancel}
    />,
  );
  expect(r.getByText("Not a training partner yet")).toBeTruthy();
  expect(r.getByText("Waiting for Kai to let you in")).toBeTruthy();
  expect(r.getByText("Asked Kai to let you in")).toBeTruthy();
  expect(
    r.getByText(/Kai sees your name and photo, nothing else/),
  ).toBeTruthy();
  r.rerender(
    <TogetherJoiningPresenter
      hostName="Tom Vance"
      connection="online"
      step="connect"
      onCancel={onCancel}
    />,
  );
  expect(r.getByText("Online · internet required")).toBeTruthy();
  expect(r.getByText(/Needs internet/)).toBeTruthy();
});
