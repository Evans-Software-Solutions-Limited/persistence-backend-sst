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
  audience: "invite-only",
  onAudienceChange: jest.fn(),
  onBrowse: jest.fn(),
  onSelectDiscovered: jest.fn(),
  onUseInvitation: jest.fn(),
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
  "browsing",
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
it("offers private by default and makes network exposure a deliberate choice", () => {
  const p = props();
  const r = renderWithTheme(<TogetherLobbyPresenter {...p} />);
  expect(
    r.getByRole("radio", { name: "Private" }).props.accessibilityState.checked,
  ).toBe(true);
  fireEvent.press(r.getByRole("radio", { name: "Open on this network" }));
  expect(p.onAudienceChange).toHaveBeenCalledWith("open");
  expect(p.onHost).not.toHaveBeenCalled();
  r.rerender(<TogetherLobbyPresenter {...p} audience="open" />);
  expect(
    r.getByRole("radio", { name: "Open on this network" }).props
      .accessibilityState.checked,
  ).toBe(true);
  fireEvent.press(r.getByRole("radio", { name: "Private" }));
  expect(p.onAudienceChange).toHaveBeenLastCalledWith("invite-only");
});
it("starts bounded browsing explicitly and selects without joining, even if advertised full", () => {
  const p = { ...props(), screen: "join" as const };
  const r = renderWithTheme(<TogetherLobbyPresenter {...p} />);
  fireEvent.press(r.getByText("Find an open lobby on this network"));
  expect(p.onBrowse).toHaveBeenCalledTimes(1);
  expect(p.onJoin).not.toHaveBeenCalled();
  r.rerender(
    <TogetherLobbyPresenter
      {...p}
      snapshot={{ phase: "browsing", members: [], pending: [], discovered: [] }}
    />,
  );
  expect(r.getByText(/No verified open lobbies found yet/)).toBeTruthy();
  r.rerender(
    <TogetherLobbyPresenter
      {...p}
      snapshot={{
        phase: "browsing",
        members: [],
        pending: [],
        discovered: [
          {
            sessionId: "s",
            hostUserId: "h",
            workoutName: "Pull day",
            memberCount: 4,
          },
        ],
      }}
    />,
  );
  expect(r.queryByText(/No verified open lobbies found yet/)).toBeNull();
  expect(r.getByText("Athletes · 4 of 4 at last check")).toBeTruthy();
  fireEvent.press(r.getByText("View lobby"));
  expect(p.onSelectDiscovered).toHaveBeenCalledWith("s");
  expect(p.onJoin).not.toHaveBeenCalled();
  fireEvent.press(r.getByText("Search again"));
  expect(p.onBrowse).toHaveBeenCalledTimes(2);
  fireEvent.press(r.getByText("Use a code or QR instead"));
  expect(p.onUseInvitation).toHaveBeenCalledTimes(1);
});
it.each(["open", "invite-only"] as const)(
  "shows actual host audience %s",
  (audience) => {
    const p = props("hosting");
    p.snapshot = { ...p.snapshot, role: "host", audience };
    const r = renderWithTheme(<TogetherLobbyPresenter {...p} />);
    expect(
      r.getByText(
        audience === "open"
          ? "Open · discoverable on this Wi-Fi or hotspot"
          : "Private · code or QR only",
      ),
    ).toBeTruthy();
  },
);

it("distinguishes stale discovery from credential expiry without requiring internet", () => {
  expect(togetherErrorCopy("discovery-expired")).toContain(
    "Search this network again",
  );
  expect(togetherErrorCopy("discovery-expired")).not.toContain("renew");
  expect(togetherErrorCopy("host-unavailable")).toContain(
    "choose another lobby",
  );
  expect(togetherErrorCopy("host-unavailable")).not.toContain(
    "paid subscription",
  );
  expect(togetherErrorCopy("expired")).toContain("renew");
});

it("blocked host invitation directs the athlete to another lobby, not a replacement code", () => {
  const p = props("unavailable");
  p.snapshot.error = "host-unavailable";
  const r = renderWithTheme(<TogetherLobbyPresenter {...p} />);
  expect(r.getByText(/This host is no longer available to join/)).toBeTruthy();
  expect(r.queryByText(/Ask the host for a new code or QR/)).toBeNull();
  expect(r.queryByText("Join the lobby")).toBeNull();
});
