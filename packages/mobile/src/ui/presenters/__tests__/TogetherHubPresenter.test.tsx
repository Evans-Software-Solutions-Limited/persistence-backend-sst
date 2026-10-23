import React from "react";
import { fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import { TogetherHubPresenter } from "../TogetherHubPresenter";
const props = () => ({
  accessState: "allowed" as const,
  onUpgrade: jest.fn(),
  onRetry: jest.fn(),
  onStart: jest.fn(),
  onJoin: jest.fn(),
  onResume: jest.fn(),
});
it("shows Start and Join rows only, with no nearby list (canvas row 1)", () => {
  const p = props(),
    r = renderWithTheme(<TogetherHubPresenter {...p} />);
  expect(r.getByText("Train together")).toBeTruthy();
  expect(r.getByText(/Up to 4 people/)).toBeTruthy();
  fireEvent.press(r.getByLabelText("Start a session"));
  fireEvent.press(r.getByLabelText("Join a session"));
  expect(p.onStart).toHaveBeenCalledTimes(1);
  expect(p.onJoin).toHaveBeenCalledTimes(1);
  expect(r.getByText("Pick a workout, then Nearby or Online")).toBeTruthy();
  expect(
    r.getByText("Scan a QR, enter a code, or find one nearby"),
  ).toBeTruthy();
  expect(r.queryByText(/No sessions nearby/)).toBeNull();
  expect(r.queryByText(/athletes/)).toBeNull();
});
it("preserves an active workout rather than offering another start or join", () => {
  const p = props(),
    r = renderWithTheme(<TogetherHubPresenter {...p} activeWorkout />);
  expect(r.queryByLabelText("Join a session")).toBeNull();
  expect(r.queryByLabelText("Start a session")).toBeNull();
  fireEvent.press(r.getByText("Back to my workout"));
  expect(p.onResume).toHaveBeenCalled();
  r.rerender(
    <TogetherHubPresenter {...p} activeWorkout onResume={undefined} />,
  );
  fireEvent.press(r.getByText("Back to my workout"));
});
it.each(["locked", "pending", "unavailable"] as const)(
  "gates the hub for %s access",
  (accessState) => {
    const p = props(),
      r = renderWithTheme(
        <TogetherHubPresenter {...p} accessState={accessState} />,
      );
    expect(r.queryByLabelText("Join a session")).toBeNull();
    expect(r.queryByLabelText("Start a session")).toBeNull();
    if (accessState === "locked") {
      fireEvent.press(r.getByText("View subscriptions"));
      fireEvent.press(r.getByText("Check access again"));
      expect(p.onUpgrade).toHaveBeenCalled();
      expect(p.onRetry).toHaveBeenCalled();
    }
    if (accessState === "pending")
      expect(r.getByText(/Checking your Together access/)).toBeTruthy();
    if (accessState === "unavailable") {
      fireEvent.press(r.getByText("Retry access check"));
      expect(p.onRetry).toHaveBeenCalled();
    }
  },
);
it("surfaces an error line above the rows", () => {
  const r = renderWithTheme(
    <TogetherHubPresenter {...props()} error="Something went wrong" />,
  );
  expect(r.getByText("Something went wrong")).toBeTruthy();
  expect(r.getByLabelText("Start a session")).toBeTruthy();
});
