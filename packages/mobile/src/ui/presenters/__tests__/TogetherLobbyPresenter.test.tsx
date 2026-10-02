import React from "react";
import { fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import {
  TogetherLobbyPresenter,
  togetherErrorCopy,
  type TogetherLobbyPresenterProps,
} from "../TogetherLobbyPresenter";
import type { TogetherLobbySnapshot } from "@/domain/ports/togetherLobby.port";
const props = (
  phase: TogetherLobbySnapshot["phase"] = "idle",
): TogetherLobbyPresenterProps => ({
  snapshot: { phase, members: [], pending: [] },
  screen: "start",
  code: "",
  notice: "",
  workoutName: "Lower Body B",
  onCodeChange: jest.fn(),
  onHost: jest.fn(),
  onSelect: jest.fn(),
  onJoin: jest.fn(),
  onScan: jest.fn(),
  onCopy: jest.fn(),
  onReconnect: jest.fn(),
  onCancel: jest.fn(),
  onApprove: jest.fn(),
  onDecline: jest.fn(),
});
it("offers paid-only host preparation without changing personal logging", () => {
  const p = props();
  const r = renderWithTheme(<TogetherLobbyPresenter {...p} />);
  expect(
    r.getByText(/Everyone needs a qualifying paid subscription/),
  ).toBeTruthy();
  fireEvent.press(r.getByText("Start the session"));
  expect(p.onHost).toHaveBeenCalledTimes(1);
  fireEvent.press(r.getByText("Cancel · keep training on my own"));
  expect(p.onCancel).toHaveBeenCalledTimes(1);
});
it("entry verifies an invitation before explicit joining", () => {
  const p = { ...props(), screen: "join" as const };
  const r = renderWithTheme(<TogetherLobbyPresenter {...p} />);
  fireEvent.press(r.getByText("Continue"));
  expect(p.onSelect).not.toHaveBeenCalled();
  fireEvent.changeText(r.getByLabelText("Session invitation"), "signed-invite");
  expect(p.onCodeChange).toHaveBeenCalledWith("signed-invite");
  r.rerender(<TogetherLobbyPresenter {...p} code="signed-invite" />);
  fireEvent.press(r.getByText("Continue"));
  expect(p.onSelect).toHaveBeenCalledTimes(1);
  expect(p.onJoin).not.toHaveBeenCalled();
  fireEvent.press(r.getByText("Scan a QR code"));
  expect(p.onScan).toHaveBeenCalledTimes(1);
});
it("shows signed selection and separate consent, with no implied PREV/log-for grants", () => {
  const p = props("selected");
  p.snapshot.selection = { hostUserId: "host-id", workoutName: "Lower Body B" };
  const r = renderWithTheme(<TogetherLobbyPresenter {...p} />);
  expect(r.getByText("Lower Body B")).toBeTruthy();
  expect(r.getByText(/does not share your history/)).toBeTruthy();
  fireEvent.press(r.getByText("Join the lobby"));
  expect(p.onJoin).toHaveBeenCalledTimes(1);
});
it("host approval and rejection target authenticated request IDs", () => {
  const p = props("hosting");
  p.snapshot = {
    ...p.snapshot,
    role: "host",
    invitation: "invite",
    members: [
      { userId: "h", host: true },
      { userId: "g", host: false },
    ],
    pending: [{ peerId: "peer", userId: "guest" }],
  };
  const r = renderWithTheme(<TogetherLobbyPresenter {...p} />);
  expect(r.getByText("Athletes · 2 of 4")).toBeTruthy();
  fireEvent.press(r.getByText("Approve"));
  expect(p.onApprove).toHaveBeenCalledWith("peer");
  fireEvent.press(r.getByText("Decline"));
  expect(p.onDecline).toHaveBeenCalledWith("peer");
  fireEvent.press(r.getByText("Copy invitation"));
  expect(p.onCopy).toHaveBeenCalledTimes(1);
  expect(r.getByText("Leave lobby · keep my workout")).toBeTruthy();
});
it.each([
  "disabled",
  "preparing",
  "searching",
  "connecting",
  "pending-approval",
  "joined",
  "reconnecting",
  "unavailable",
  "full",
] as const)("honest %s state", (phase) => {
  const p = props(phase);
  p.notice = "Personal workout retained";
  p.snapshot.error = "wifi_unavailable";
  const r = renderWithTheme(<TogetherLobbyPresenter {...p} />);
  expect(r.queryByText("Start the session")).toBeNull();
  expect(r.getByText("Personal workout retained")).toBeTruthy();
  if (phase === "reconnecting") {
    fireEvent.press(r.getByText("Reconnect"));
    expect(p.onReconnect).toHaveBeenCalledTimes(1);
  }
});
it.each([
  undefined,
  "expired",
  "offline-unprepared",
  "unauthorized",
  "permission",
  "unreachable",
  "invalid-proof",
  "declined",
  "key-unavailable",
  "other",
])("explains %s without treating internet as LAN permission", (code) => {
  expect(togetherErrorCopy(code)).toEqual(code ? expect.any(String) : "");
});
