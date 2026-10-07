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

it.each(["active", "reconnecting", "local-only", "paused"] as const)(
  "reports %s own-workout durability without claiming server acceptance",
  (sharing) => {
    const p = props(sharing === "local-only" ? "idle" : "joined");
    const r = renderWithTheme(
      <TogetherLobbyPresenter
        {...p}
        workoutStatus={{
          sessionId: "s",
          executionId: "e",
          localSessionId: "l",
          sharing,
          receivedCount: 3,
          pendingCount: 2,
        }}
      />,
    );
    expect(r.getByText("My workout")).toBeTruthy();
    expect(
      r.getByText(/Your complete workout journal is retained/),
    ).toBeTruthy();
    expect(
      r.getByText(
        /private shared view|shared views have separate delivery receipts/i,
      ),
    ).toBeTruthy();
    expect(r.queryByText("Start the session")).toBeNull();
    expect(r.queryByText(/Your workout remains personal/)).toBeNull();
    if (sharing === "paused")
      expect(r.getByText(/sharing stays paused/)).toBeTruthy();
    if (sharing === "local-only")
      expect(r.getByText(/does not rejoin or reopen/)).toBeTruthy();
  },
);
it("requires promotion consent separately from admission", () => {
  const p = props("joined"),
    onPromote = jest.fn();
  const r = renderWithTheme(
    <TogetherLobbyPresenter {...p} onPromote={onPromote} />,
  );
  expect(onPromote).not.toHaveBeenCalled();
  expect(
    r.getByText(/Your exercises and logged sets stay in place/),
  ).toBeTruthy();
  expect(r.getByText(/own result before saving/)).toBeTruthy();
  fireEvent.press(r.getByText("Use my workout in Together"));
  expect(onPromote).toHaveBeenCalledTimes(1);
});

it.each(["hosting", "browsing", "searching"] as const)(
  "describes %s using nearby transport without a Wi-Fi gate",
  (phase) => {
    const p = props(phase);
    p.snapshot.transport = "nearby";
    const r = renderWithTheme(<TogetherLobbyPresenter {...p} />);
    expect(r.queryByText(/Wi-Fi|hotspot/)).toBeNull();
    expect(r.getAllByText(/nearby/i).length).toBeGreaterThan(0);
  },
);
it("keeps explicit hotspot-owner and nearby permission/unreachable states distinct", () => {
  expect(togetherErrorCopy("permission-denied", "nearby")).toMatch(
    /Bluetooth and nearby-device/,
  );
  expect(togetherErrorCopy("timeout", "nearby")).toMatch(/both phones nearby/);
  expect(togetherErrorCopy("permission-denied", "hotspot-owner")).toMatch(
    /this Android phone’s hotspot/,
  );
  expect(togetherErrorCopy("timeout", "hotspot-owner")).toMatch(
    /other phone is connected/,
  );
  const p = props("idle");
  p.snapshot.transport = "hotspot-owner";
  const r = renderWithTheme(<TogetherLobbyPresenter {...p} />);
  expect(
    r.getByText("Athletes on this Android phone’s hotspot can find it"),
  ).toBeTruthy();
  expect(r.getByText(/Discovery depends on device support/)).toBeTruthy();
  r.rerender(
    <TogetherLobbyPresenter
      {...p}
      snapshot={{ ...p.snapshot, transport: "nearby" }}
    />,
  );
  expect(r.getByText("Athletes nearby can find it")).toBeTruthy();
  expect(r.getByText("Open nearby")).toBeTruthy();
});

it("nearby discovery expiry asks to search nearby, and hotspot browsing names the owner mode", () => {
  expect(togetherErrorCopy("discovery-expired", "nearby")).toMatch(
    /Search nearby again/,
  );
  expect(togetherErrorCopy("discovery-expired", "hotspot-owner")).toMatch(
    /Android phone’s hotspot/,
  );
  expect(togetherErrorCopy("removed-from-session")).toMatch(
    /own workout remains/,
  );
  const p = props("browsing");
  const r = renderWithTheme(
    <TogetherLobbyPresenter
      {...p}
      snapshot={{ ...p.snapshot, transport: "hotspot-owner" }}
    />,
  );
  expect(
    r.getByText(/Only open lobbies reachable through this Android phone/),
  ).toBeTruthy();
  r.rerender(
    <TogetherLobbyPresenter
      {...p}
      screen="join"
      snapshot={{ ...p.snapshot, phase: "idle", transport: "nearby" }}
    />,
  );
  expect(r.getByText("Find an open lobby nearby")).toBeTruthy();
  expect(r.queryByText(/Use the same Wi-Fi/)).toBeNull();
  r.rerender(
    <TogetherLobbyPresenter
      {...p}
      screen="join"
      snapshot={{ ...p.snapshot, phase: "idle", transport: "hotspot-owner" }}
    />,
  );
  expect(r.getByText(/Connect the other phones/)).toBeTruthy();
});

it.each([
  ["authentication-required", "Sign in again"],
  ["signed-out", "Sign in again"],
  ["service-unavailable", "account or app environment"],
  ["device-revoked", "was revoked"],
  ["registration-conflict", "register this device"],
  ["registration-invalid", "date and time"],
  ["unauthorized", "could not be authorized"],
  ["ineligible", "could not be authorized"],
])(
  "shows the specific %s failure without mislabeling it a subscription denial",
  (code, message) => {
    const p = props("unavailable");
    p.snapshot.error = code;
    const r = renderWithTheme(<TogetherLobbyPresenter {...p} />);
    expect(r.getByText(togetherErrorCopy(code))).toBeTruthy();
    expect(togetherErrorCopy(code)).toContain(message);
    expect(
      r.queryByText(/Every athlete needs a qualifying paid subscription/),
    ).toBeNull();
  },
);
it.each(["paid-required", "PAID_REQUIRED"])(
  "identifies explicit %s subscription denial",
  (code) => {
    expect(togetherErrorCopy(code)).toContain("qualifying paid subscription");
  },
);

it("shows named athlete cards without exposing internal account IDs", () => {
  const p = props("hosting");
  p.accountId = "private-owner-id";
  p.athleteNames = {
    "private-owner-id": "Brad Evans",
    "private-guest-id": "Mia",
  };
  p.snapshot.members = [
    { userId: "private-owner-id", host: true },
    { userId: "private-guest-id", host: false },
    { userId: "unknown-private-id", host: false },
  ];
  const r = renderWithTheme(<TogetherLobbyPresenter {...p} />);
  expect(r.getByText("Brad Evans")).toBeTruthy();
  expect(r.getByText("Mia")).toBeTruthy();
  expect(r.getByText("Athlete 3")).toBeTruthy();
  expect(r.getByText("Host · You")).toBeTruthy();
  expect(
    r.queryByText(/private-id|private-owner-id|private-guest-id/),
  ).toBeNull();
});
