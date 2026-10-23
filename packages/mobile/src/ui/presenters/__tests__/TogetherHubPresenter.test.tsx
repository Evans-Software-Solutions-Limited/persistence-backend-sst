import React from "react";
import { fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import { TogetherHubPresenter } from "../TogetherHubPresenter";
const partners = [
  { userId: "tom", name: "Tom Vance", live: { sessionId: "s1", occupancy: 2 } },
  { userId: "brad", name: "Brad Evans", since: "July" },
  { userId: "ines", name: "Inés Marco" },
  {
    userId: "lena",
    name: "Lena Ford",
    live: { sessionId: "s2", occupancy: 4 },
  },
];
const props = () => ({
  accessState: "allowed" as const,
  onUpgrade: jest.fn(),
  onRetry: jest.fn(),
  onStart: jest.fn(),
  onJoin: jest.fn(),
  onResume: jest.fn(),
  partners,
  onPartner: jest.fn(),
  onJoinOnline: jest.fn(),
  refreshing: false,
  onRefresh: jest.fn(),
});
it("shows Start and Join rows, the partners card with Online sessions, and the footnote (canvas row 1)", () => {
  const p = props(),
    r = renderWithTheme(<TogetherHubPresenter {...p} />);
  expect(r.getByText("Train together")).toBeTruthy();
  expect(r.getByText(/Up to 4 people/)).toBeTruthy();
  fireEvent.press(r.getByLabelText("Start a session"));
  fireEvent.press(r.getByLabelText("Join a session"));
  expect(p.onStart).toHaveBeenCalledTimes(1);
  expect(p.onJoin).toHaveBeenCalledTimes(1);
  expect(r.getByText("Training partners · 4")).toBeTruthy();
  expect(r.getByText("Training now · 2 of 4 · Online")).toBeTruthy();
  expect(r.getByText("Partners since July")).toBeTruthy();
  expect(r.getByText("Training partner")).toBeTruthy();
  fireEvent.press(r.getByLabelText("Join Tom Vance"));
  expect(p.onJoinOnline).toHaveBeenCalledWith("s1");
  expect(
    r.getByLabelText("Join Lena Ford").props.accessibilityState.disabled,
  ).toBe(true);
  expect(r.getByText("Full")).toBeTruthy();
  fireEvent.press(r.getByLabelText("View Brad Evans"));
  expect(p.onPartner).toHaveBeenCalledWith("brad");
  expect(
    r.getByText(/A partner’s session shows here when it’s Online/),
  ).toBeTruthy();
  expect(r.queryByText(/No sessions nearby/)).toBeNull();
  expect(
    r.getByTestId("together-hub-content").props.refreshControl.props.onRefresh,
  ).toBe(p.onRefresh);
});
it("explains an empty partner list and a partner-load error", () => {
  const r = renderWithTheme(
    <TogetherHubPresenter
      {...props()}
      partners={[]}
      partnersError="Could not refresh training partners."
    />,
  );
  expect(r.getByText("Training partners · 0")).toBeTruthy();
  expect(r.getByText(/No training partners yet/)).toBeTruthy();
  expect(r.getByText("Could not refresh training partners.")).toBeTruthy();
});
it("preserves an active workout rather than offering another start or join", () => {
  const p = props(),
    r = renderWithTheme(<TogetherHubPresenter {...p} activeWorkout />);
  expect(r.queryByLabelText("Join a session")).toBeNull();
  expect(r.queryByLabelText("Start a session")).toBeNull();
  expect(r.queryByLabelText("Join Tom Vance")).toBeNull();
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
