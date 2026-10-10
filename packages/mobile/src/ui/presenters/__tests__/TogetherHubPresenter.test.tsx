import React from "react";
import { fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import { TogetherHubPresenter } from "../TogetherHubPresenter";
const props = () => ({
  accessState: "allowed" as const,
  onUpgrade: jest.fn(),
  onRetry: jest.fn(),
  onWorkouts: jest.fn(),
  onJoin: jest.fn(),
  onScan: jest.fn(),
  onSelect: jest.fn(),
  onResume: jest.fn(),
});
it("offers reachable join, scanner and guided start even without a current workout", () => {
  const p = props(),
    r = renderWithTheme(<TogetherHubPresenter {...p} />);
  fireEvent.press(r.getByText("Join a session"));
  expect(r.queryByText("Scan invitation")).toBeNull();
  fireEvent.press(r.getByText("Choose workout"));
  expect(p.onJoin).toHaveBeenCalledTimes(1);
  expect(p.onScan).not.toHaveBeenCalled();
  expect(p.onWorkouts).toHaveBeenCalledTimes(1);
});
it("shows verified available sessions without exposing host account IDs", () => {
  const p = props(),
    r = renderWithTheme(
      <TogetherHubPresenter
        {...p}
        sessions={[
          { sessionId: "signed-session", workoutName: "Push", memberCount: 2 },
        ]}
      />,
    );
  fireEvent.press(r.getByLabelText("Join Push"));
  expect(p.onSelect).toHaveBeenCalledWith("signed-session");
  expect(r.getByText("Push")).toBeTruthy();
  expect(r.getByText("2 / 4 athletes")).toBeTruthy();
});
it("preserves an active workout rather than offering another admission", () => {
  const p = props(),
    r = renderWithTheme(<TogetherHubPresenter {...p} activeWorkout />);
  expect(r.queryByText("Join a session")).toBeNull();
  fireEvent.press(r.getByText("Back to my workout"));
  expect(p.onResume).toHaveBeenCalled();
});
it.each(["locked", "pending", "unavailable"] as const)(
  "gates admission for %s access",
  (accessState) => {
    const p = props(),
      r = renderWithTheme(
        <TogetherHubPresenter {...p} accessState={accessState} />,
      );
    expect(r.queryByText("Join a session")).toBeNull();
    expect(r.queryByText("Choose workout")).toBeNull();
    if (accessState === "locked") {
      fireEvent.press(r.getByText("View subscriptions"));
      fireEvent.press(r.getByText("Check access again"));
      expect(p.onUpgrade).toHaveBeenCalled();
      expect(p.onRetry).toHaveBeenCalled();
    }
    if (accessState === "unavailable") {
      fireEvent.press(r.getByText("Retry access check"));
      expect(p.onRetry).toHaveBeenCalled();
    }
  },
);
it("shows discovery status and failure guidance and safely handles optional actions", () => {
  const p = props(),
    r = renderWithTheme(
      <TogetherHubPresenter
        {...p}
        discovering
        error="Discovery unavailable"
        onJoin={undefined}
        onScan={undefined}
        onResume={undefined}
      />,
    );
  expect(r.getByText("No workouts available to you")).toBeTruthy();
  expect(r.getByText("Discovery unavailable")).toBeTruthy();
  fireEvent.press(r.getByText("Join a session"));
  expect(r.queryByText("Scan invitation")).toBeNull();
  r.rerender(
    <TogetherHubPresenter {...p} activeWorkout onResume={undefined} />,
  );
  fireEvent.press(r.getByText("Back to my workout"));
});
