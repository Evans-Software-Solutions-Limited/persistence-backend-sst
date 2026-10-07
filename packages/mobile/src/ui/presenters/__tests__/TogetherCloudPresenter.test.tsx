import React from "react";
import { fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import {
  TogetherCloudPresenter,
  togetherCloudErrorCopy,
} from "../TogetherCloudPresenter";
import type { CloudSnapshot } from "@/domain/ports/togetherCloud.port";
const snapshot: CloudSnapshot = {
  sessionId: "s",
  state: "active",
  sharingActive: true,
  continuation: null,
  hostId: "me",
  revision: 3,
  planVersion: 1,
  plan: { name: "Push", exercises: [] },
  participants: [],
  completion: {
    status: "active",
    historyId: null,
    ownRevision: 1,
    recoveryMayBePending: false,
  },
};
function props(): React.ComponentProps<typeof TogetherCloudPresenter> {
  return {
    state: { phase: "idle", requests: [], previous: {}, pendingCount: 0 },
    accountId: "me",
    workoutName: "Push",
    code: "",
    busy: false,
    notice: "",
    friends: [],
    onCode: jest.fn(),
    onHost: jest.fn(),
    onJoin: jest.fn(),
    onFriends: jest.fn(),
    onSelectFriend: jest.fn(),
    onInvite: jest.fn(),
    onRevoke: jest.fn(),
    onDecision: jest.fn(),
    onRetry: jest.fn(),
    onReview: jest.fn(),
    onCancel: jest.fn(),
    onLocal: jest.fn(),
    onPartners: jest.fn(),
    onVisible: jest.fn(),
  };
}
it("requires deliberate remote join and honest full friend session controls", () => {
  const p = props();
  const r = renderWithTheme(
    <TogetherCloudPresenter
      {...p}
      friends={[
        { sessionId: "open", hostName: "Mia", occupancy: 2 },
        { sessionId: "full", hostName: "Tom", occupancy: 4 },
      ]}
    />,
  );
  fireEvent.press(r.getByText("Join deliberately"));
  expect(p.onJoin).not.toHaveBeenCalled();
  fireEvent.changeText(r.getByLabelText("Remote invitation"), "token");
  expect(p.onCode).toHaveBeenCalledWith("token");
  fireEvent.press(r.getByText("Join Tom"));
  expect(p.onSelectFriend).not.toHaveBeenCalled();
  fireEvent.press(r.getByText("Join Mia"));
  expect(p.onSelectFriend).toHaveBeenCalledWith("open");
  fireEvent.press(r.getByText("Start remote session"));
  fireEvent.press(r.getByText("Find training partners’ sessions"));
  fireEvent.press(r.getByText("Use nearby or Wi-Fi instead"));
  fireEvent.press(r.getByText("Training partners"));
  fireEvent.press(r.getByText("Cancel · keep my workout"));
  fireEvent.press(r.getByText("Retry connection"));
  [
    p.onHost,
    p.onFriends,
    p.onLocal,
    p.onPartners,
    p.onCancel,
    p.onRetry,
  ].forEach((fn) => expect(fn).toHaveBeenCalledTimes(1));
  r.rerender(<TogetherCloudPresenter {...p} code="token" />);
  fireEvent.press(r.getByText("Join deliberately"));
  expect(p.onJoin).toHaveBeenCalledTimes(1);
});
it("keeps pending and preparing honest and blocks duplicate actions while busy", () => {
  const p = props();
  const r = renderWithTheme(
    <TogetherCloudPresenter
      {...p}
      code="token"
      busy
      state={{ ...p.state, phase: "preparing" }}
    />,
  );
  expect(r.getByText("Preparing your session…")).toBeTruthy();
  fireEvent.press(r.getByText("Start remote session"));
  fireEvent.press(r.getByText("Join deliberately"));
  expect(p.onHost).not.toHaveBeenCalled();
  expect(p.onJoin).not.toHaveBeenCalled();
  r.rerender(
    <TogetherCloudPresenter
      {...p}
      state={{ ...p.state, phase: "pending-approval" }}
    />,
  );
  expect(r.getByText(/Waiting for host approval/)).toBeTruthy();
  expect(r.queryByText("Start remote session")).toBeNull();
});
it("only an active host gets invite, visibility and stranger approval controls", () => {
  const p = props(),
    state = {
      ...p.state,
      phase: "active" as const,
      snapshot,
      requests: [
        {
          requestId: "r",
          userId: "stranger",
          displayName: null,
          avatarUrl: null,
        },
      ],
    };
  const r = renderWithTheme(
    <TogetherCloudPresenter {...p} state={state} invitation="secret" />,
  );
  fireEvent.press(r.getByText("Copy invitation"));
  fireEvent.press(r.getByText("Revoke this invitation"));
  fireEvent.press(r.getByText("Show to training partners for 15 minutes"));
  fireEvent.press(r.getByText("Approve"));
  fireEvent.press(r.getByText("Decline"));
  fireEvent.press(r.getByText("Review my result"));
  expect(p.onInvite).toHaveBeenCalledTimes(1);
  expect(p.onRevoke).toHaveBeenCalledTimes(1);
  expect(p.onVisible).toHaveBeenCalledTimes(1);
  expect(p.onReview).toHaveBeenCalledTimes(1);
  expect(p.onDecision).toHaveBeenNthCalledWith(1, "r", true);
  expect(p.onDecision).toHaveBeenNthCalledWith(2, "r", false);
  r.rerender(<TogetherCloudPresenter {...p} accountId="guest" state={state} />);
  expect(r.queryByText("Copy invitation")).toBeNull();
  expect(r.queryByText("Approve")).toBeNull();
  r.rerender(
    <TogetherCloudPresenter
      {...p}
      state={{ ...state, snapshot: { ...snapshot, sharingActive: false } }}
    />,
  );
  expect(r.queryByText("Approve")).toBeNull();
  expect(r.queryByText("Copy invitation")).toBeNull();
  expect(r.getByText(/Sharing ended/)).toBeTruthy();
});
it("cannot approve a fifth athlete and never describes pending delivery as server confirmed", () => {
  const p = props();
  const participants = Array.from({ length: 4 }, (_, i) => ({
    userId: String(i),
    status: "active" as const,
    ownRevision: 0,
    delegationGeneration: 0,
    allowPartnerLogging: false,
    execution: null,
    numbersAvailable: false,
    previousValuesAvailable: false,
    exerciseCatalog: {},
  }));
  const state = {
    ...p.state,
    phase: "reconnecting" as const,
    pendingCount: 2,
    snapshot: { ...snapshot, participants },
    requests: [
      { requestId: "r", userId: "new", displayName: "Kai", avatarUrl: null },
    ],
    error: "Network unavailable",
  };
  const r = renderWithTheme(<TogetherCloudPresenter {...p} state={state} />);
  expect(r.getByText(/Reconnecting · your changes are kept/)).toBeTruthy();
  expect(
    r.getByText("Changes awaiting server acknowledgement: 2"),
  ).toBeTruthy();
  expect(r.getByText(/Remote sharing needs internet/)).toBeTruthy();
  fireEvent.press(r.getByText("Approve"));
  expect(p.onDecision).not.toHaveBeenCalled();
  fireEvent.press(r.getByText("Decline"));
  expect(p.onDecision).toHaveBeenCalledWith("r", false);
  r.rerender(
    <TogetherCloudPresenter {...p} state={state} notice="Specific error" />,
  );
  expect(r.getByText(/Remote sharing needs internet/)).toBeTruthy();
  expect(r.queryByText("Specific error")).toBeNull();
  expect(r.queryByText("Network unavailable")).toBeNull();
});

it.each([
  ["SESSION_FULL", "All four places are occupied"],
  ["ineligible", "You can keep logging your own workout"],
  ["approval_required", "Waiting for host approval"],
  ["cloud-join-rejected", "The host declined"],
  ["removed-from-session", "You were removed"],
  ["timeout", "Remote sharing needs internet"],
  ["VERSION_CONFLICT", "Refresh and review the latest state"],
  ["unauthorized", "Sign in to the account"],
  ["FORBIDDEN", "no longer authorized"],
  ["INVITE_EXPIRED", "Ask the host for a new invitation"],
  ["cloud-join-unavailable", "no longer available to join"],
])(
  "explains %s without displaying raw backend codes or a generic overriding notice",
  (error, copy) => {
    const p = props();
    const r = renderWithTheme(
      <TogetherCloudPresenter
        {...p}
        notice="Generic failure"
        state={{ ...p.state, phase: "unavailable", error }}
      />,
    );
    expect(r.getByText(new RegExp(copy))).toBeTruthy();
    expect(r.queryByText(error)).toBeNull();
    expect(r.queryByText("Generic failure")).toBeNull();
  },
);
it("contains unknown backend errors and still shows useful caller notices", () => {
  const p = props();
  const r = renderWithTheme(
    <TogetherCloudPresenter
      {...p}
      state={{ ...p.state, error: "internal SQL query with details" }}
    />,
  );
  expect(r.getByText(/Could not confirm remote sharing/)).toBeTruthy();
  expect(r.queryByText(/internal SQL/)).toBeNull();
  r.rerender(<TogetherCloudPresenter {...p} notice="Invite copied" />);
  expect(r.getByText("Invite copied")).toBeTruthy();
});

it("explains known admission failures without exposing raw server strings", () => {
  expect(togetherCloudErrorCopy("PAID_REQUIRED")).toMatch(
    /qualifying paid subscription/,
  );
  expect(togetherCloudErrorCopy("INVALID_SCHEMA")).toMatch(
    /Continue personally/,
  );
  expect(togetherCloudErrorCopy("unrecognized-internal-error")).toBeNull();
});
