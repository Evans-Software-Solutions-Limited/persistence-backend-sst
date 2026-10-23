import React from "react";
import { View } from "react-native";
import { fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import {
  TogetherJoinPresenter,
  type TogetherJoinRow,
} from "../TogetherJoinPresenter";
const rows: TogetherJoinRow[] = [
  {
    id: "brad",
    title: "Brad Evans",
    subtitle: "Lower Body B · 3 of 4",
    kind: "partner-nearby",
  },
  {
    id: "kai",
    title: "Push A",
    subtitle: "1 of 4",
    kind: "nearby",
    hostName: "Kai",
  },
  { id: "lena", title: "Lena Ford", subtitle: "Full · 4 of 4", kind: "full" },
  { id: "tom", title: "Tom Vance", subtitle: "2 of 4", kind: "online" },
];
const props = () => ({
  code: "",
  onCode: jest.fn(),
  onContinue: jest.fn(),
  onScan: jest.fn(),
  search: "found" as const,
  rows,
  refreshing: false,
  onRefresh: jest.fn(),
  onOpenSettings: jest.fn(),
  onSelect: jest.fn(),
  onBack: jest.fn(),
});
it("shows the found rows with the right verification line and action per kind", () => {
  const p = props();
  const r = renderWithTheme(<TogetherJoinPresenter {...p} />);
  expect(r.getByText("Join a session")).toBeTruthy();
  expect(r.getByText("Sessions you can join")).toBeTruthy();
  expect(r.getByText("Pull down to refresh")).toBeTruthy();
  expect(r.getByText("Verified partner · Nearby")).toBeTruthy();
  expect(r.getByText("Nearby · Kai lets you in")).toBeTruthy();
  expect(r.getByText("Online · internet required")).toBeTruthy();
  expect(r.getByText("Full")).toBeTruthy();
  fireEvent.press(r.getByLabelText("Join Brad Evans"));
  fireEvent.press(r.getByLabelText("Ask to join Push A"));
  fireEvent.press(r.getByLabelText("Join Tom Vance"));
  expect(p.onSelect.mock.calls.map((c) => c[0])).toEqual([
    "brad",
    "kai",
    "tom",
  ]);
  expect(r.queryByLabelText(/Lena Ford/)).toBeNull();
  r.rerender(
    <TogetherJoinPresenter
      {...p}
      rows={[{ id: "x", title: "Pull B", subtitle: "1 of 4", kind: "nearby" }]}
    />,
  );
  expect(r.getByText("Nearby · the host lets you in")).toBeTruthy();
});
it("searching shows the clock, placeholders and the 30 s note; found rows stay while it runs", () => {
  const p = props();
  const r = renderWithTheme(
    <TogetherJoinPresenter
      {...p}
      search="searching"
      elapsedSeconds={68}
      rows={[]}
    />,
  );
  expect(r.getByText("Searching nearby · 1:08")).toBeTruthy();
  expect(r.getByText("Stops by itself after 30 seconds.")).toBeTruthy();
  expect(r.queryByText("Pull down to refresh")).toBeNull();
  r.rerender(
    <TogetherJoinPresenter {...p} search="searching" elapsedSeconds={8} />,
  );
  expect(r.getByText("Searching nearby · 0:08")).toBeTruthy();
  expect(r.getByText("Brad Evans")).toBeTruthy();
});
it("nothing found explains the 30 s search and offers Search again", () => {
  const p = props();
  const r = renderWithTheme(
    <TogetherJoinPresenter {...p} search="empty" rows={[]} />,
  );
  expect(r.getByText("No sessions nearby")).toBeTruthy();
  expect(r.getByText(/Searched for 30 seconds/)).toBeTruthy();
  fireEvent.press(r.getByText("Search again"));
  expect(p.onRefresh).toHaveBeenCalledTimes(1);
});
it("can't search names the radio, opens Settings or tries again, and keeps Online rows", () => {
  const p = props();
  const r = renderWithTheme(
    <TogetherJoinPresenter
      {...p}
      search="failed"
      rows={[rows[3]!]}
      failure="Wi-Fi is off. Turn it on in Settings. You don’t need to join a network."
    />,
  );
  expect(r.getByText("Can’t search nearby")).toBeTruthy();
  expect(r.getByText(/Wi-Fi is off/)).toBeTruthy();
  expect(r.getByText(/Online sessions from partners still show/)).toBeTruthy();
  expect(r.getByText("Tom Vance")).toBeTruthy();
  fireEvent.press(r.getByText("Open Settings"));
  fireEvent.press(r.getByText("Try again"));
  expect(p.onOpenSettings).toHaveBeenCalledTimes(1);
  expect(p.onRefresh).toHaveBeenCalledTimes(1);
  r.rerender(<TogetherJoinPresenter {...p} search="failed" rows={[]} />);
  expect(r.getByText(/Wi-Fi is off/)).toBeTruthy();
});
it("unavailable nearby search still allows the code, scan and Online rows", () => {
  const p = props();
  const r = renderWithTheme(
    <TogetherJoinPresenter {...p} search="unavailable" rows={[rows[3]!]} />,
  );
  expect(
    r.getByText(/Nearby search is not available on this phone/),
  ).toBeTruthy();
  expect(r.getByText("Tom Vance")).toBeTruthy();
});
it("code entry gates Continue, scanning renders the camera, and the notice is an alert", () => {
  const p = props();
  const r = renderWithTheme(
    <TogetherJoinPresenter
      {...p}
      scanner={<View testID="camera" />}
      notice="Bad code"
      busy
    />,
  );
  expect(r.getByTestId("camera")).toBeTruthy();
  expect(r.getByText("Bad code")).toBeTruthy();
  fireEvent.changeText(r.getByLabelText("Session code"), "abc");
  expect(p.onCode).toHaveBeenCalledWith("abc");
  fireEvent.press(r.getByText("Continue"));
  expect(p.onContinue).not.toHaveBeenCalled();
  r.rerender(<TogetherJoinPresenter {...p} code="abc" />);
  fireEvent.press(r.getByText("Continue"));
  fireEvent.press(r.getByText("Scan a QR code"));
  fireEvent.press(r.getByLabelText("Back"));
  expect(p.onContinue).toHaveBeenCalledTimes(1);
  expect(p.onScan).toHaveBeenCalledTimes(1);
  expect(p.onBack).toHaveBeenCalledTimes(1);
  expect(
    r.getByTestId("together-join-scroll").props.refreshControl.props.onRefresh,
  ).toBe(p.onRefresh);
});
