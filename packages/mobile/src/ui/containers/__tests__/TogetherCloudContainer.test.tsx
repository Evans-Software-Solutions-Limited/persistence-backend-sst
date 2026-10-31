import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { TogetherCloudController } from "../../../adapters/together/cloudSession";
import { fail } from "@/shared/errors/result";
import React from "react";
import QRCode from "react-native-qrcode-svg";
import { Alert, AppState, Share, Text } from "react-native";
import { act, fireEvent, waitFor } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import {
  TogetherCloudContainer,
  cloudSharedView,
} from "../TogetherCloudContainer";
import { TogetherCloudPresenter } from "../../presenters/TogetherCloudPresenter";
import { TogetherPartnerPresenter } from "../../presenters/TogetherPartnerPresenter";
import { TogetherSharingPresenter } from "../../presenters/TogetherSharingPresenter";
import { TogetherWorkoutRow } from "../../presenters/TogetherWorkoutRow";
import type {
  TogetherCloudApi,
  TogetherCloudPort,
  TogetherCloudState,
  CloudSnapshot,
} from "@/domain/ports/togetherCloud.port";
import type { WorkoutSession } from "@/domain/models/session";
import { useTogetherSettings } from "@/state/together-settings";
import { rosterSeen, forgetRoster } from "@/ui/state/togetherRosterSeen";
const mockCameraPermission = jest.fn();
jest.mock("expo-camera", () => ({
  useCameraPermissions: () => [null, mockCameraPermission],
  CameraView: "CameraView",
}));
jest.mock("react-native-qrcode-svg", () => "QRCode");
const mockPush = jest.fn(),
  mockCopy = jest.fn();
jest.mock("expo-router", () => ({
  router: { push: (...args: unknown[]) => mockPush(...args) },
}));
jest.mock("expo-clipboard", () => ({
  setStringAsync: (...args: unknown[]) => mockCopy(...args),
}));
jest.mock("expo-crypto", () => ({ randomUUID: () => "uuid" }));
const mockSheetHeight = jest.fn();
jest.mock("@/ui/components/foundation/BottomSheet", () => ({
  BottomSheet: (p: {
    visible: boolean;
    children: React.ReactNode;
    footer?: React.ReactNode;
    height?: unknown;
  }) => {
    mockSheetHeight(p.height);
    return p.visible ? (
      <>
        {p.children}
        {p.footer}
      </>
    ) : null;
  },
}));
const server: CloudSnapshot = {
  sessionId: "s",
  state: "active",
  sharingActive: true,
  continuation: null,
  hostId: "u",
  revision: 1,
  planVersion: 1,
  plan: {
    name: "Push",
    exercises: [
      { planExerciseId: "slot", exerciseId: "ex", order: 0, targetSets: 2 },
    ],
  },
  completion: {
    status: "active",
    historyId: null,
    ownRevision: 1,
    recoveryMayBePending: false,
  },
  participants: [
    {
      userId: "u",
      status: "active",
      ownRevision: 1,
      delegationGeneration: 1,
      allowPartnerLogging: false,
      execution: { exercises: [] },
      numbersAvailable: true,
      previousValuesAvailable: true,
      numbersConsent: { version: 0, recipientIds: [] },
      previousConsent: { version: 0, recipientIds: [] },
      exerciseCatalog: {},
    },
    {
      userId: "v",
      status: "active",
      ownRevision: 3,
      delegationGeneration: 2,
      allowPartnerLogging: true,
      execution: {
        exercises: [
          {
            planExerciseId: "slot",
            skipped: false,
            sets: [{ setId: "set", reps: 8, weightKg: 60, completed: true }],
          },
        ],
      },
      numbersAvailable: true,
      previousValuesAvailable: true,
      exerciseCatalog: {
        ex: { name: "Squat", category: "strength", primaryMuscles: [] },
      },
    },
  ],
};
function setup(active = false) {
  let state: TogetherCloudState = {
    phase: active ? "active" : "idle",
    requests: [],
    previous: {},
    pendingCount: 0,
    ...(active ? { snapshot: structuredClone(server) } : {}),
  };
  const listeners = new Set<() => void>();
  const publish = (patch: Partial<TogetherCloudState>) => {
    state = { ...state, ...patch };
    listeners.forEach((l) => l());
  };
  const cloud = {
    getSnapshot: () => state,
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    hostWorkout: jest.fn(async () => {}),
    join: jest.fn(async () => {}),
    resume: jest.fn(async () => {}),
    cancel: jest.fn(),
    cancelJoin: jest.fn(async () => {}),
    remove: jest.fn(async () => {}),
    detachDraft: jest.fn(),
    retry: jest.fn(async () => {}),
    invite: jest.fn(async () => ({
      tokenId: "token-id",
      token: "invite",
      expiresAt: new Date(Date.now() + 900_000).toISOString(),
    })),
    revokeInvite: jest.fn(async () => {}),
    friends: jest.fn(async () => ({
      ok: true,
      value: {
        data: [
          {
            sessionId: "friend-session",
            host: { userId: "friend", displayName: "Mia", avatarUrl: null },
            occupancy: 2,
            expiresAt: new Date(Date.now() + 900_000).toISOString(),
            workoutName: "Push A",
            startedAt: new Date().toISOString(),
            plan: [],
          },
        ],
        nextCursor: null,
      },
    })),
    decide: jest.fn(async () => {}),
    previous: jest.fn(async () => {}),
    command: jest.fn(async () => {}),
    numbersConsent: jest.fn(async () => {}),
    previousConsent: jest.fn(async () => {}),
    delegation: jest.fn(async () => {}),
    // Accepted at once: the refreshed snapshot reports the new audience.
    visibility: jest.fn(async (audience: "private" | "friends") => {
      if (state.snapshot)
        publish({ snapshot: { ...state.snapshot, audience } });
    }),
  } as unknown as TogetherCloudPort;
  const draft: WorkoutSession = {
    id: "local",
    userId: "u",
    name: "Push",
    workoutId: null,
    status: "in_progress",
    startedAt: "2026-10-05T10:00:00Z",
    completedAt: null,
    notes: null,
    exercises: [],
  };
  const props = {
    cloud,
    accountId: "u",
    workoutName: "Push",
    getWorkout: () => draft,
    onLocal: jest.fn(),
  };
  return { cloud, publish, props, state: () => state, draft };
}
const ui = (r: ReturnType<typeof renderWithTheme>) =>
  r.UNSAFE_getByType(TogetherCloudPresenter).props as React.ComponentProps<
    typeof TogetherCloudPresenter
  >;
beforeEach(() => {
  jest
    .spyOn(AppState, "addEventListener")
    .mockImplementation(() => ({ remove: jest.fn() }));
  mockPush.mockReset();
  mockCopy.mockReset().mockResolvedValue(undefined);
});
it("hosts only current personal draft; friend listing and invitation joins remain deliberate", async () => {
  const h = setup();
  const r = renderWithTheme(<TogetherCloudContainer {...h.props} />);
  fireEvent.press(r.getByText("Open"));
  fireEvent.press(r.getByText("Start remote session"));
  await waitFor(() =>
    expect(h.cloud.hostWorkout).toHaveBeenCalledWith(h.draft),
  );
  await act(async () => {});
  fireEvent.press(r.getByText("Find training partners’ sessions"));
  await waitFor(() => expect(r.getByText("Join Mia")).toBeTruthy());
  expect(h.cloud.join).not.toHaveBeenCalled();
  fireEvent.press(r.getByText("Join Mia"));
  await waitFor(() =>
    expect(h.cloud.join).toHaveBeenCalledWith(
      { sessionId: "friend-session" },
      h.draft,
    ),
  );
  await act(async () => {});
  fireEvent.changeText(r.getByLabelText("Remote invitation"), " signed ");
  fireEvent.press(r.getByText("Join deliberately"));
  await waitFor(() =>
    expect(h.cloud.join).toHaveBeenCalledWith(
      { inviteToken: "signed" },
      h.draft,
    ),
  );
});
it("wires host invitations, join requests, who can join and every-partner sharing from the strip", async () => {
  const h = setup(true);
  const r = renderWithTheme(<TogetherCloudContainer {...h.props} />);
  // Invite opens the invitation; the request bar lets someone in or not.
  await act(async () => fireEvent.press(r.getByText("Invite")));
  expect(h.cloud.invite).toHaveBeenCalledTimes(1);
  act(() =>
    h.publish({
      requests: [
        {
          requestId: "request",
          userId: "w",
          displayName: "Tom",
          avatarUrl: null,
        },
      ],
    }),
  );
  await act(async () => fireEvent.press(r.getByText("Let in")));
  expect(h.cloud.decide).toHaveBeenCalledWith("request", "approve");
  await act(async () => fireEvent.press(r.getByText("No")));
  expect(h.cloud.decide).toHaveBeenCalledWith("request", "reject");
  // The cog: three switches for everyone else, and the host's Who can join.
  fireEvent.press(r.getByLabelText("Together settings"));
  const settings = () =>
    r.UNSAFE_getByType(TogetherSharingPresenter).props as React.ComponentProps<
      typeof TogetherSharingPresenter
    >;
  expect(settings().visible).toBe(true);
  await act(async () => settings().onChange({ key: "numbers", value: true }));
  expect(h.cloud.numbersConsent).toHaveBeenCalledWith(["v"]);
  await act(async () => settings().onChange({ key: "previous", value: true }));
  expect(h.cloud.previousConsent).toHaveBeenCalledWith(["v"]);
  await act(async () => settings().onChange({ key: "logging", value: true }));
  expect(h.cloud.delegation).toHaveBeenCalledWith(true);
  expect(settings().audience?.value).toBeUndefined();
  await act(async () => settings().audience!.onChange("friends"));
  expect(h.cloud.visibility).toHaveBeenCalledWith(
    "friends",
    expect.any(String),
  );
  expect(settings().audience?.value).toBe("friends");
  // Open nearby is Nearby-only.
  await act(async () => settings().audience!.onChange("open"));
  expect(h.cloud.visibility).toHaveBeenCalledTimes(1);
  // Tapping the value it shows sends it again.
  await act(async () => settings().audience!.onChange("friends"));
  expect(h.cloud.visibility).toHaveBeenCalledTimes(2);
  // Offline the change stays in the outbox, which the controller reports.
  jest.mocked(h.cloud.visibility).mockImplementationOnce(async () => {
    h.publish({ pendingVisibility: "private" });
    throw new Error("offline");
  });
  await act(async () => settings().audience!.onChange("invite-only"));
  expect(h.cloud.visibility).toHaveBeenLastCalledWith(
    "private",
    expect.any(String),
  );
  expect(settings().audience?.value).toBe("invite-only");
  act(() => settings().onDone());
  expect(settings().visible).toBe(false);
});

it("does not apply a late friend lookup or chained consent to another account", async () => {
  const h = setup();
  let resolve!: (x: Awaited<ReturnType<TogetherCloudPort["friends"]>>) => void;
  jest.mocked(h.cloud.friends).mockReturnValue(
    new Promise((r) => {
      resolve = r;
    }),
  );
  const r = renderWithTheme(<TogetherCloudContainer {...h.props} />);
  fireEvent.press(r.getByText("Open"));
  fireEvent.press(r.getByText("Find training partners’ sessions"));
  await act(async () => {});
  r.rerender(<TogetherCloudContainer {...h.props} accountId="other" />);
  await act(async () =>
    resolve({
      ok: true,
      value: {
        data: [
          {
            sessionId: "old",
            host: {
              userId: "old",
              displayName: "Old private friend",
              avatarUrl: null,
            },
            occupancy: 2,
            expiresAt: new Date(Date.now() + 900_000).toISOString(),
            workoutName: "Push A",
            startedAt: new Date().toISOString(),
            plan: [],
          },
        ],
        nextCursor: null,
      },
    }),
  );
  expect(r.queryByText(/Old private friend/)).toBeNull();
});
it("keeps partner values scoped and hides all private state while reconnecting", () => {
  const h = setup(true);
  const active = {
    ...h.state(),
    previous: {
      v: {
        sessionId: "s",
        ownerId: "v",
        consentVersion: 1,
        revision: 1,
        planVersion: 1,
        ownRevision: 3,
        values: [
          {
            exerciseId: "ex",
            setNumber: 1,
            reps: 5,
            weightKg: 40,
            recordedAt: "2026-01-01",
          },
          {},
        ],
      },
    },
  };
  const shown = cloudSharedView(active, "u");
  expect(shown.athletes[0].exercises.slot.sets[0].weightKg).toBe(60);
  expect(shown.previous.v).toHaveLength(1);
  const hidden = cloudSharedView({ ...active, phase: "reconnecting" }, "u");
  expect(hidden.athletes).toEqual([]);
  expect(hidden.previous).toEqual({});
  const revoked = cloudSharedView(
    {
      ...active,
      snapshot: {
        ...server,
        participants: server.participants.map((p) => ({
          ...p,
          numbersAvailable: false,
          previousValuesAvailable: false,
        })),
      },
    },
    "u",
  );
  expect(revoked.athletes).toEqual([]);
  expect(revoked.previous).toEqual({});
});

it("selects partner views and sends edits against the revision actually displayed", async () => {
  const h = setup(true);
  const r = renderWithTheme(<TogetherCloudContainer {...h.props} />);
  fireEvent.press(r.getByLabelText("Show Athlete 2’s workout"));
  await act(async () => {});
  expect(h.cloud.previous).toHaveBeenCalledWith("v");
  // The planned second set, logged for the partner.
  fireEvent.changeText(r.getAllByTestId("set-logger-reps")[1]!, "8");
  fireEvent.changeText(r.getAllByTestId("set-logger-weight")[1]!, "62.5");
  fireEvent(r.getAllByTestId("set-logger-weight")[1]!, "blur");
  await act(async () => {});
  expect(h.cloud.command).toHaveBeenCalledWith({
    target: { kind: "execution", athleteId: "v" },
    expectedVersion: 3,
    delegationGeneration: 2,
    operation: {
      type: "upsertSet",
      planExerciseId: "slot",
      set: { setId: "uuid", reps: 8, weightKg: 62.5, completed: true },
    },
  });
  act(() => h.publish({ phase: "reconnecting" }));
  expect(r.queryByTestId("set-logger-reps")).toBeNull();
  fireEvent.press(r.getByLabelText("Show my workout"));
  expect(r.queryByTestId("together-partner-view")).toBeNull();
});
it("Online partner tab: planned rows editable at once, own avatar returns, a revoked grant refuses mid-view", async () => {
  const h = setup(true);
  const r = renderWithTheme(
    <TogetherCloudContainer {...h.props}>
      {(row, partnerView) => (
        <>
          {row}
          {partnerView ?? <Text testID="own-workout">own</Text>}
        </>
      )}
    </TogetherCloudContainer>,
  );
  expect(r.getByTestId("own-workout")).toBeTruthy();
  fireEvent.press(r.getByLabelText("Show Athlete 2’s workout"));
  await act(async () => {});
  expect(r.queryByTestId("own-workout")).toBeNull();
  expect(r.getByText("Squat")).toBeTruthy();
  const reps = () => r.getAllByTestId("set-logger-reps");
  // One logged set and one planned (targetSets 2), both editable straight away.
  expect(reps().map((input) => input.props.value)).toEqual(["8", ""]);
  expect(reps()[1]!.props.editable).toBe(true);
  fireEvent.changeText(reps()[1]!, "8");
  fireEvent.changeText(r.getAllByTestId("set-logger-weight")[1]!, "62.5");
  fireEvent(reps()[1]!, "blur");
  await waitFor(() =>
    expect(h.cloud.command).toHaveBeenCalledWith({
      target: { kind: "execution", athleteId: "v" },
      expectedVersion: 3,
      delegationGeneration: 2,
      operation: {
        type: "upsertSet",
        planExerciseId: "slot",
        set: { setId: "uuid", reps: 8, weightKg: 62.5, completed: true },
      },
    }),
  );
  // The partner turns fill-in off while the view is open.
  const off = structuredClone(h.state().snapshot!);
  off.participants[1]!.allowPartnerLogging = false;
  act(() => h.publish({ snapshot: off }));
  expect(
    r.getByText("Training partner · read-only. Fill-in is off."),
  ).toBeTruthy();
  expect(reps().every((input) => input.props.editable === false)).toBe(true);
  const partner = r.UNSAFE_getByType(TogetherPartnerPresenter).props;
  expect(partner.editable).toBe(false);
  // Nothing can be queued for a partner who turned fill-in off.
  act(() => {
    partner.outbox.edit("late", { reps: 5, weightKg: 50 }, "");
    partner.outbox.commit("late", "slot");
  });
  await act(async () => {});
  expect(h.cloud.command).toHaveBeenCalledTimes(1);
  fireEvent.press(r.getByLabelText("Show my workout"));
  expect(r.getByTestId("own-workout")).toBeTruthy();
});
it("Online: a set queued behind one in flight is sent after its echo, though the echo bumps the partner's revision", async () => {
  const h = setup(true);
  h.state().snapshot!.plan.exercises[0]!.targetSets = 3;
  const r = renderWithTheme(<TogetherCloudContainer {...h.props} />);
  fireEvent.press(r.getByLabelText("Show Athlete 2’s workout"));
  await act(async () => {});
  const reps = () => r.getAllByTestId("set-logger-reps");
  const kg = () => r.getAllByTestId("set-logger-weight");
  fireEvent.changeText(reps()[1]!, "8");
  fireEvent.changeText(kg()[1]!, "62.5");
  fireEvent(kg()[1]!, "blur");
  fireEvent.changeText(reps()[2]!, "7");
  fireEvent.changeText(kg()[2]!, "62.5");
  fireEvent(kg()[2]!, "blur");
  await act(async () => {});
  expect(h.cloud.command).toHaveBeenCalledTimes(1);
  const sent = jest.mocked(h.cloud.command).mock.calls[0]![0] as unknown as {
    operation: { set: { setId: string } };
  };
  // The server applies it: the partner's revision moves from 3 to 4.
  const next = structuredClone(h.state().snapshot!);
  const partner = next.participants[1]!;
  partner.ownRevision = 4;
  partner.execution!.exercises[0]!.sets.push({
    setId: sent.operation.set.setId,
    reps: 8,
    weightKg: 62.5,
    completed: true,
  });
  act(() => h.publish({ snapshot: next }));
  await act(async () => {});
  expect(h.cloud.command).toHaveBeenCalledTimes(2);
  expect(h.cloud.command).toHaveBeenLastCalledWith(
    expect.objectContaining({
      expectedVersion: 4,
      operation: expect.objectContaining({
        set: expect.objectContaining({ reps: 7, weightKg: 62.5 }),
      }),
    }),
  );
  expect(reps().map((input) => input.props.value)).toEqual(["8", "8", "7"]);
});
it("Online: a set queued for a partner is still sent after you switch back to your own workout", async () => {
  const h = setup(true);
  h.state().snapshot!.plan.exercises[0]!.targetSets = 3;
  const r = renderWithTheme(
    <TogetherCloudContainer {...h.props}>
      {(row, partnerView) => (
        <>
          {row}
          {partnerView ?? <Text testID="own-workout">own</Text>}
        </>
      )}
    </TogetherCloudContainer>,
  );
  fireEvent.press(r.getByLabelText("Show Athlete 2’s workout"));
  await act(async () => {});
  const fillRow = (i: number, reps: string) => {
    fireEvent.changeText(r.getAllByTestId("set-logger-reps")[i]!, reps);
    fireEvent.changeText(r.getAllByTestId("set-logger-weight")[i]!, "62.5");
    fireEvent(r.getAllByTestId("set-logger-weight")[i]!, "blur");
  };
  fillRow(1, "8");
  fillRow(2, "7");
  await act(async () => {});
  expect(h.cloud.command).toHaveBeenCalledTimes(1);
  fireEvent.press(r.getByLabelText("Show my workout"));
  expect(r.getByTestId("own-workout")).toBeTruthy();
  const sent = jest.mocked(h.cloud.command).mock.calls[0]![0] as unknown as {
    operation: { set: { setId: string } };
  };
  const next = structuredClone(h.state().snapshot!);
  next.participants[1]!.ownRevision = 4;
  next.participants[1]!.execution!.exercises[0]!.sets.push({
    setId: sent.operation.set.setId,
    reps: 8,
    weightKg: 62.5,
    completed: true,
  });
  act(() => h.publish({ snapshot: next }));
  await act(async () => {});
  expect(h.cloud.command).toHaveBeenCalledTimes(2);
  expect(h.cloud.command).toHaveBeenLastCalledWith(
    expect.objectContaining({
      expectedVersion: 4,
      operation: expect.objectContaining({
        set: expect.objectContaining({ reps: 7 }),
      }),
    }),
  );
});
it("Online: a brief reconnect keeps what you typed for a partner", async () => {
  const h = setup(true);
  const r = renderWithTheme(<TogetherCloudContainer {...h.props} />);
  fireEvent.press(r.getByLabelText("Show Athlete 2’s workout"));
  await act(async () => {});
  fireEvent.changeText(r.getAllByTestId("set-logger-reps")[1]!, "8");
  const active = structuredClone(h.state().snapshot!);
  // A poll times out: the session hides partners' numbers and fill-in.
  const hidden = structuredClone(active);
  hidden.participants[1]!.numbersAvailable = false;
  hidden.participants[1]!.allowPartnerLogging = false;
  act(() => h.publish({ phase: "reconnecting", snapshot: hidden }));
  await act(async () => {});
  act(() => h.publish({ phase: "active", snapshot: active }));
  await act(async () => {});
  expect(r.getAllByTestId("set-logger-reps")[1]!.props.value).toBe("8");
  expect(r.queryByTestId("set-logger-sync-notsent")).toBeNull();
});
it("Online: the partner view closes when the partner leaves or the session snapshot is lost", async () => {
  const h = setup(true);
  const r = renderWithTheme(
    <TogetherCloudContainer {...h.props}>
      {(row, partnerView) => (
        <>
          {row}
          {partnerView ?? <Text testID="own-workout">own</Text>}
        </>
      )}
    </TogetherCloudContainer>,
  );
  fireEvent.press(r.getByLabelText("Show Athlete 2’s workout"));
  await act(async () => {});
  expect(r.queryByTestId("own-workout")).toBeNull();
  // The partner leaves the session.
  const left = structuredClone(h.state().snapshot!);
  left.participants = left.participants.filter((x) => x.userId !== "v");
  act(() => h.publish({ snapshot: left }));
  expect(r.getByTestId("own-workout")).toBeTruthy();
  expect(r.queryByTestId("together-partner-view")).toBeNull();
  // Back in, then the snapshot is lost (backgrounded, reconnect failed): no
  // strip, so the partner view must not stay either.
  act(() => h.publish({ snapshot: structuredClone(server) }));
  fireEvent.press(r.getByLabelText("Show Athlete 2’s workout"));
  await act(async () => {});
  expect(r.queryByTestId("own-workout")).toBeNull();
  act(() => h.publish({ phase: "unavailable", snapshot: undefined }));
  expect(r.getByTestId("own-workout")).toBeTruthy();
  // When the session comes back, you are on your own workout, not dropped
  // back into the partner's.
  act(() => h.publish({ phase: "active", snapshot: structuredClone(server) }));
  expect(r.getByTestId("own-workout")).toBeTruthy();
});
it("Online: a partner who finished their own workout drops off the host's strip and tabs (TestFlight 31 Oct)", async () => {
  // An older guest app finishes without leaving, so the server keeps their
  // seat with a saved result: the host's phone kept showing them.
  const h = setup(true);
  const r = renderWithTheme(
    <TogetherCloudContainer {...h.props}>
      {(row, partnerView) => (
        <>
          {row}
          {partnerView ?? <Text testID="own-workout">own</Text>}
        </>
      )}
    </TogetherCloudContainer>,
  );
  const strip = () =>
    r.UNSAFE_getByType(TogetherWorkoutRow).props as React.ComponentProps<
      typeof TogetherWorkoutRow
    >;
  expect(strip().members.map((m) => m.userId)).toEqual(["u", "v"]);
  expect(strip().status).toBe("In sync · 2 training");
  fireEvent.press(r.getByLabelText("Show Athlete 2’s workout"));
  await act(async () => {});
  expect(r.queryByTestId("own-workout")).toBeNull();
  const finished = structuredClone(h.state().snapshot!);
  finished.participants.find((x) => x.userId === "v")!.status = "saved";
  act(() => h.publish({ snapshot: finished }));
  expect(strip().members.map((m) => m.userId)).toEqual(["u"]);
  // Their seat stays taken on the server, so the count is seats, not faces.
  expect(strip().status).toBe("Waiting for people · 2 of 4");
  expect(r.getByTestId("own-workout")).toBeTruthy();
  expect(r.queryByLabelText("Show Athlete 2’s workout")).toBeNull();
  fireEvent.press(r.getByText("End"));
  expect(
    r.getByText(
      "Everyone keeps their own workout and carries on solo. Nobody new can join.",
    ),
  ).toBeTruthy();
});
it("Online: backgrounding for a moment keeps what you typed for a partner", async () => {
  const h = setup(true);
  const r = renderWithTheme(<TogetherCloudContainer {...h.props} />);
  fireEvent.press(r.getByLabelText("Show Athlete 2’s workout"));
  await act(async () => {});
  fireEvent.changeText(r.getAllByTestId("set-logger-reps")[1]!, "8");
  // setActive(false) resets the session state; the resume reattaches it.
  act(() => h.publish({ phase: "idle", snapshot: undefined }));
  act(() => h.publish({ phase: "active", snapshot: structuredClone(server) }));
  fireEvent.press(r.getByLabelText("Show Athlete 2’s workout"));
  await act(async () => {});
  expect(r.getAllByTestId("set-logger-reps")[1]!.props.value).toBe("8");
});
it("surfaces command errors and wires retry, cancel, partner navigation and local choice", async () => {
  const h = setup();
  jest.mocked(h.cloud.hostWorkout).mockRejectedValue(new Error("subscription"));
  const r = renderWithTheme(<TogetherCloudContainer {...h.props} />);
  fireEvent.press(r.getByText("Open"));
  fireEvent.press(r.getByText("Start remote session"));
  await waitFor(() => expect(r.getByText(/Could not complete/)).toBeTruthy());
  await act(async () => ui(r).onRetry());
  expect(h.cloud.retry).toHaveBeenCalledTimes(1);
  act(() => ui(r).onLocal());
  expect(h.cloud.cancel).toHaveBeenCalledTimes(1);
  expect(h.props.onLocal).toHaveBeenCalledTimes(1);
  act(() => ui(r).onCancel());
  fireEvent.press(r.getByText("Open"));
  act(() => ui(r).onPartners());
  expect(mockPush).toHaveBeenCalledWith("/(app)/together/partners");
});
it("Partners lasts the session, and the expiry sent never cuts the session short", async () => {
  const h = setup(true);
  const r = renderWithTheme(
    <TogetherCloudContainer {...h.props} initialHost="friends" />,
  );
  await act(async () => {});
  const audience = () =>
    r.UNSAFE_getByType(TogetherSharingPresenter).props.audience?.value;
  expect(audience()).toBe("friends");
  // Older servers wrote this over the session's lifetime: never 15 minutes.
  const sent = Date.parse(
    jest.mocked(h.cloud.visibility).mock.calls.at(-1)![1] as string,
  );
  // Two hours: long enough there, and within an older server's 4-hour cap
  // even when this phone's clock runs up to two hours fast.
  expect(sent).toBeGreaterThan(Date.now() + 1.9 * 3600_000);
  expect(sent).toBeLessThanOrEqual(Date.now() + 2 * 3600_000);
  // A current server says when the session ends: the listing lasts that long,
  // whatever this phone's clock says (inspector lead).
  const endsAt = new Date(Date.now() + 3.5 * 3600_000).toISOString();
  act(() => h.publish({ snapshot: { ...h.state().snapshot!, endsAt } }));
  await act(async () =>
    r
      .UNSAFE_getByType(TogetherSharingPresenter)
      .props.audience.onChange("invite-only"),
  );
  expect(jest.mocked(h.cloud.visibility).mock.calls.at(-1)).toEqual([
    "private",
    endsAt,
  ]);
});
it("Who can join claims nothing until Partners is actually sent, and a new session starts unknown again", async () => {
  const h = setup(true);
  const r = renderWithTheme(<TogetherCloudContainer {...h.props} />);
  const audience = () =>
    r.UNSAFE_getByType(TogetherSharingPresenter).props.audience?.value;
  // Nothing was sent and the server said nothing: no choice is claimed.
  expect(audience()).toBeUndefined();
  await act(async () =>
    r
      .UNSAFE_getByType(TogetherSharingPresenter)
      .props.audience.onChange("friends"),
  );
  expect(audience()).toBe("friends");
  act(() =>
    h.publish({
      snapshot: { ...h.state().snapshot!, sessionId: "next", audience: null },
    }),
  );
  expect(audience()).toBeUndefined();
});
it("keeps Who can join through a minimise and reopen of the session screen", async () => {
  const h = setup(true);
  const first = renderWithTheme(<TogetherCloudContainer {...h.props} />);
  await act(async () =>
    first
      .UNSAFE_getByType(TogetherSharingPresenter)
      .props.audience.onChange("friends"),
  );
  // Minimise unmounts the screen; reopening mounts a fresh one.
  first.unmount();
  const again = renderWithTheme(<TogetherCloudContainer {...h.props} />);
  expect(
    again.UNSAFE_getByType(TogetherSharingPresenter).props.audience?.value,
  ).toBe("friends");
});
it("after a restart, Who can join reads the server's answer, and shows no choice when there is none", () => {
  // Nothing sent from this run of the app (beforeEach clears it).
  const h = setup(true);
  const r = renderWithTheme(<TogetherCloudContainer {...h.props} />);
  const audience = () =>
    r.UNSAFE_getByType(TogetherSharingPresenter).props.audience?.value;
  // An older server says nothing: no segment is claimed.
  expect(audience()).toBeUndefined();
  act(() =>
    h.publish({ snapshot: { ...h.state().snapshot!, audience: "friends" } }),
  );
  expect(audience()).toBe("friends");
  act(() =>
    h.publish({ snapshot: { ...h.state().snapshot!, audience: "private" } }),
  );
  expect(audience()).toBe("invite-only");
});
it("a refused Who can join gives way to the server's answer; one queued offline still shows, and one dropped later leaves nothing behind", async () => {
  const h = setup(true);
  h.state().snapshot!.audience = "private";
  const r = renderWithTheme(<TogetherCloudContainer {...h.props} />);
  const audience = () =>
    r.UNSAFE_getByType(TogetherSharingPresenter).props.audience;
  expect(audience().value).toBe("invite-only");
  jest
    .mocked(h.cloud.visibility)
    .mockRejectedValueOnce(new Error("cloud-visibility-refused"));
  await act(async () => audience().onChange("friends"));
  expect(audience().value).toBe("invite-only");
  // Offline: still in the outbox, so the host's choice shows.
  jest.mocked(h.cloud.visibility).mockImplementationOnce(async () => {
    h.publish({ pendingVisibility: "friends" });
    throw new Error("network");
  });
  await act(async () => audience().onChange("friends"));
  expect(audience().value).toBe("friends");
  // On reconnect the server refuses it and the outbox drops it.
  act(() => h.publish({ pendingVisibility: undefined }));
  expect(audience().value).toBe("invite-only");
});
it("queues every changed permission at once without waiting on the first, and a late rejection after the account changes shows nothing", async () => {
  const h = setup(true);
  let reject!: (error: Error) => void;
  jest.mocked(h.cloud.numbersConsent).mockReturnValue(
    new Promise((_r, rej) => {
      reject = rej;
    }),
  );
  const r = renderWithTheme(<TogetherCloudContainer {...h.props} />);
  fireEvent.press(r.getByLabelText("Together settings"));
  const settings = () =>
    r.UNSAFE_getByType(TogetherSharingPresenter).props as React.ComponentProps<
      typeof TogetherSharingPresenter
    >;
  act(() => settings().onChange({ key: "numbers", value: true }));
  // Nothing awaits the in-flight numbers request: each switch moves and sends
  // on its tap, and the sheet is not locked while they settle.
  expect(settings().state?.numbers).toBe(true);
  act(() => settings().onChange({ key: "previous", value: true }));
  act(() => settings().onChange({ key: "logging", value: true }));
  expect(h.cloud.numbersConsent).toHaveBeenCalledWith(["v"]);
  expect(h.cloud.previousConsent).toHaveBeenCalledWith(["v"]);
  expect(h.cloud.delegation).toHaveBeenCalledWith(true);
  await act(async () => {});
  r.rerender(<TogetherCloudContainer {...h.props} accountId="other" />);
  await act(async () => reject(new Error("FORBIDDEN")));
  expect(r.queryByTestId("together-sharing-refused")).toBeNull();
  expect(settings().visible).toBe(false);
});

it("tells the athlete when the server definitively rejects a sharing change", async () => {
  const h = setup(true);
  jest
    .mocked(h.cloud.previousConsent)
    .mockRejectedValueOnce(new Error("FORBIDDEN"));
  const r = renderWithTheme(<TogetherCloudContainer {...h.props} />);
  fireEvent.press(r.getByLabelText("Together settings"));
  const settings = () =>
    r.UNSAFE_getByType(TogetherSharingPresenter).props as React.ComponentProps<
      typeof TogetherSharingPresenter
    >;
  await act(async () => settings().onChange({ key: "previous", value: true }));
  expect(h.cloud.previousConsent).toHaveBeenCalledWith(["v"]);
  expect(h.cloud.numbersConsent).not.toHaveBeenCalled();
  // The switch is back off, with the one notice.
  expect(settings().state?.previous).toBe(false);
  expect(
    r.getByText(
      "Couldn’t turn on previous values. The session didn’t accept it, so it’s switched back off.",
    ),
  ).toBeTruthy();
  // The next change clears it.
  await act(async () => settings().onChange({ key: "numbers", value: true }));
  expect(r.queryByTestId("together-sharing-refused")).toBeNull();
});

it("ignores stale invitation replies after unmount and resumes only a persisted cloud session", async () => {
  const h = setup(true);
  let resolve!: (v: {
    tokenId: string;
    token: string;
    expiresAt: string;
  }) => void;
  jest.mocked(h.cloud.invite).mockReturnValue(
    new Promise((r) => {
      resolve = r;
    }),
  );
  const r = renderWithTheme(<TogetherCloudContainer {...h.props} />);
  fireEvent.press(r.getByText("Invite"));
  await act(async () => {});
  r.unmount();
  await act(async () =>
    resolve({
      tokenId: "id",
      token: "private",
      expiresAt: new Date(Date.now() + 900_000).toISOString(),
    }),
  );
  expect(mockCopy).not.toHaveBeenCalled();
  const pending = setup();
  pending.draft.together = {
    sessionId: "persisted",
    executionId: "own",
    transport: "cloud",
  };
  renderWithTheme(<TogetherCloudContainer {...pending.props} />);
  await waitFor(() => expect(pending.cloud.retry).toHaveBeenCalledTimes(1));
  expect(pending.cloud.join).not.toHaveBeenCalled();
});
it("cancels pending admission at the server and offers only explicit safe personal continuation", async () => {
  const h = setup();
  act(() => h.publish({ phase: "pending-approval" }));
  const restore = jest.fn();
  const r = renderWithTheme(
    <TogetherCloudContainer {...h.props} onRestorePersonal={restore} />,
  );
  fireEvent.press(r.getByText("Open"));
  act(() => ui(r).onCancel());
  await waitFor(() => expect(h.cloud.cancelJoin).toHaveBeenCalledTimes(1));
  await act(async () => {});
  expect(h.cloud.cancel).not.toHaveBeenCalled();
  act(() => h.publish({ phase: "unavailable", canDetachDraft: true }));
  jest.mocked(h.cloud.detachDraft).mockImplementation((_, persist) => {
    persist(h.draft);
    return h.draft;
  });
  fireEvent.press(r.getByText("Open"));
  fireEvent.press(r.getByText("Continue personally"));
  await waitFor(() => expect(restore).toHaveBeenCalledWith(h.draft));
  expect(h.props.onLocal).toHaveBeenCalledTimes(1);
});
it("does not remove someone after the removal dialog account has changed", async () => {
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  const h = setup(true);
  const r = renderWithTheme(<TogetherCloudContainer {...h.props} />);
  fireEvent.press(r.getByLabelText("Together settings"));
  const settings = r.UNSAFE_getByType(TogetherSharingPresenter)
    .props as React.ComponentProps<typeof TogetherSharingPresenter>;
  act(() => settings.onRemove!("v"));
  const confirm = alert.mock.calls
    .at(-1)![2]!
    .find((b) => b.text === "Remove")!.onPress!;
  r.rerender(<TogetherCloudContainer {...h.props} accountId="new" />);
  await act(async () => confirm());
  expect(h.cloud.remove).not.toHaveBeenCalled();
  r.rerender(<TogetherCloudContainer {...h.props} />);
  act(() => r.UNSAFE_getByType(TogetherSharingPresenter).props.onRemove("v"));
  await act(async () =>
    alert.mock.calls.at(-1)![2]!.find((b) => b.text === "Remove")!.onPress!(),
  );
  expect(h.cloud.remove).toHaveBeenCalledWith("v");
  alert.mockRestore();
});
it("clears revoked per-recipient consent from the settings sheet", async () => {
  const h = setup(true);
  h.state().snapshot!.participants[0].numbersConsent = {
    version: 1,
    recipientIds: ["v", "another"],
  };
  h.state().snapshot!.participants[0].previousConsent = {
    version: 1,
    recipientIds: ["v"],
  };
  const r = renderWithTheme(<TogetherCloudContainer {...h.props} />);
  fireEvent.press(r.getByLabelText("Together settings"));
  expect(mockPush).not.toHaveBeenCalled();
  const settings = () =>
    r.UNSAFE_getByType(TogetherSharingPresenter).props as React.ComponentProps<
      typeof TogetherSharingPresenter
    >;
  expect(settings().state).toMatchObject({ numbers: true, previous: true });
  await act(async () => settings().onChange({ key: "numbers", value: false }));
  expect(h.cloud.numbersConsent).toHaveBeenCalledWith([]);
  await act(async () => settings().onChange({ recipient: "v", value: false }));
  expect(h.cloud.previousConsent).toHaveBeenCalledWith([]);
});

it("renders private progress with no execution or consent objects from older snapshots", () => {
  const minimal = {
    ...server,
    sharingActive: false,
    participants: [
      {
        ...server.participants[0],
        numbersConsent: undefined,
        previousConsent: undefined,
      },
      {
        ...server.participants[1],
        displayName: "Mia",
        execution: {
          exercises: [
            {
              planExerciseId: "slot",
              substituteExerciseId: "alternate",
              skipped: true,
              sets: [],
            },
          ],
          restEndsAt: "2026-10-05T12:00:00Z",
        },
        progress: [{ planExerciseId: "slot", completedSets: 2, skipped: true }],
      },
    ],
  };
  const closed = cloudSharedView(
    {
      phase: "private",
      snapshot: minimal,
      requests: [],
      previous: {},
      pendingCount: 0,
    },
    "u",
  );
  expect(closed.closures).toEqual([{ userId: "u", mode: "leave" }]);
  const active = cloudSharedView(
    {
      phase: "active",
      snapshot: { ...minimal, sharingActive: true },
      requests: [],
      previous: {},
      pendingCount: 0,
    },
    "u",
  );
  expect(active.profiles.v).toBe("Mia");
  expect(active.athletes[0].exercises.slot.exerciseId).toBe("alternate");
  expect(active.progress[0].exercises[0].completedSets).toBe(2);
  expect(active.grants[0].consent.numbers).toBe(false);
  expect(
    cloudSharedView(
      { phase: "idle", requests: [], previous: {}, pendingCount: 0 },
      "u",
    ).athletes,
  ).toEqual([]);
});
it("does not host a disappeared workout, retries once while busy and handles friend failure", async () => {
  const h = setup();
  const r = renderWithTheme(
    <TogetherCloudContainer {...h.props} getWorkout={() => null} />,
  );
  fireEvent.press(r.getByText("Open"));
  act(() => ui(r).onHost());
  await waitFor(() => expect(r.getByText(/Could not complete/)).toBeTruthy());
  expect(h.cloud.hostWorkout).not.toHaveBeenCalled();
  let reject!: (e: Error) => void;
  jest.mocked(h.cloud.retry).mockReturnValue(
    new Promise((_, r) => {
      reject = r;
    }),
  );
  const controls = ui(r);
  act(() => {
    controls.onRetry();
    controls.onRetry();
  });
  await act(async () => {});
  expect(h.cloud.retry).toHaveBeenCalledTimes(1);
  await act(async () => reject(new Error("offline")));
  jest.mocked(h.cloud.friends).mockResolvedValue({
    ok: false,
    error: { kind: "api", code: "network", message: "offline" },
  });
  await act(async () => ui(r).onFriends());
  expect(r.getByText(/Could not complete/)).toBeTruthy();
});
it("shows failed persisted reconnection and ignores late error on unmount", async () => {
  const h = setup();
  h.draft.together = {
    sessionId: "persisted",
    executionId: "own",
    transport: "cloud",
  };
  jest.mocked(h.cloud.retry).mockRejectedValue(new Error("offline"));
  const r = renderWithTheme(<TogetherCloudContainer {...h.props} />);
  fireEvent.press(r.getByText("Open"));
  await waitFor(() => expect(r.getByText(/Could not reconnect/)).toBeTruthy());
  r.unmount();
});

it("uses guest controls and keeps revoked partner edits and missing join drafts from sending", async () => {
  const h = setup(true);
  const r = renderWithTheme(
    <TogetherCloudContainer
      {...h.props}
      accountId="v"
      getWorkout={() => null}
    />,
  );
  fireEvent.press(r.getByLabelText("Together settings"));
  const settings = r.UNSAFE_getByType(TogetherSharingPresenter).props;
  // A guest gets the switches only: no Who can join, nobody to remove.
  expect(settings.audience).toBeUndefined();
  expect(settings.removable).toBeUndefined();
  await act(async () => settings.onChange({ key: "numbers", value: true }));
  expect(h.cloud.numbersConsent).toHaveBeenCalledWith(["u"]);
  fireEvent.press(r.getByLabelText("Show Athlete 1’s workout"));
  const partner = r.UNSAFE_getByType(TogetherPartnerPresenter).props;
  // The host has not turned on fill-in: nothing is sent.
  expect(partner.editable).toBe(false);
  act(() => {
    partner.outbox.edit("x", { reps: 5, weightKg: 50 }, "");
    partner.outbox.commit("x", "slot");
  });
  await act(async () => {});
  expect(h.cloud.command).not.toHaveBeenCalled();
  // Joining without a workout of your own sends nothing.
  const idle = setup();
  const j = renderWithTheme(
    <TogetherCloudContainer {...idle.props} getWorkout={() => null} />,
  );
  fireEvent.press(j.getByText("Open"));
  await act(async () => ui(j).onJoin());
  await act(async () => ui(j).onSelectFriend("missing"));
  expect(idle.cloud.join).not.toHaveBeenCalled();
});

it("does not reissue unchanged grants; selects Mine without PREV access", async () => {
  const h = setup(true);
  h.state().snapshot!.participants[0].previousValuesAvailable = false;
  const r = renderWithTheme(<TogetherCloudContainer {...h.props} />);
  fireEvent.press(r.getByLabelText("Together settings"));
  const settings = r.UNSAFE_getByType(TogetherSharingPresenter).props;
  await act(async () => settings.onChange({ key: "numbers", value: false }));
  await act(async () => settings.onChange({ key: "logging", value: false }));
  await act(async () => settings.onChange({ recipient: "v", value: false }));
  expect(h.cloud.numbersConsent).not.toHaveBeenCalled();
  expect(h.cloud.previousConsent).not.toHaveBeenCalled();
  expect(h.cloud.delegation).not.toHaveBeenCalled();
  fireEvent.press(r.getByLabelText("Show my workout"));
  expect(h.cloud.previous).not.toHaveBeenCalled();
  expect(r.queryByTestId("together-partner-view")).toBeNull();
});

it("discards queued actions and errors when the account changes before execution", async () => {
  const h = setup();
  const r = renderWithTheme(<TogetherCloudContainer {...h.props} />);
  fireEvent.press(r.getByText("Open"));
  const old = ui(r);
  act(() => {
    old.onRetry();
    r.rerender(<TogetherCloudContainer {...h.props} accountId="other" />);
  });
  await act(async () => {});
  expect(h.cloud.retry).not.toHaveBeenCalled();
  act(() => old.onHost());
  await act(async () => {});
  expect(h.cloud.hostWorkout).not.toHaveBeenCalled();
});

it("restores a personal workout through the real controller after terminal initial admission failure", async () => {
  const h = setup();
  const db = new DatabaseSync(":memory:");
  const controller = new TogetherCloudController({
    api: {
      join: jest.fn(async () =>
        fail({
          kind: "api",
          code: "server",
          togetherCode: "SESSION_FULL",
          message: "Full",
        }),
      ),
    } as unknown as TogetherCloudApi,
    randomUUID,
    db: {
      execSync: (sql) => db.exec(sql),
      runSync: (sql, params) => db.prepare(sql).run(...params),
      getFirstSync: <T,>(sql: string, params: (string | number | null)[]) =>
        (db.prepare(sql).get(...params) as T) ?? null,
      getAllSync: <T,>(sql: string, params: (string | number | null)[]) =>
        db.prepare(sql).all(...params) as T[],
      withTransactionSync: (fn) => {
        db.exec("BEGIN");
        try {
          fn();
          db.exec("COMMIT");
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
      },
    },
  });
  controller.setAccount("u");
  const restore = jest.fn();
  try {
    await expect(
      controller.join({ sessionId: randomUUID() }, h.draft),
    ).rejects.toThrow("SESSION_FULL");
    const r = renderWithTheme(
      <TogetherCloudContainer
        {...h.props}
        cloud={controller}
        onRestorePersonal={restore}
      />,
    );
    fireEvent.press(r.getByText("Open"));
    fireEvent.press(r.getByText("Continue personally"));
    await waitFor(() => expect(restore).toHaveBeenCalledWith(h.draft));
    expect(h.props.onLocal).toHaveBeenCalledTimes(1);
    expect(controller.readDraft("u")).toBeNull();
    r.unmount();
  } finally {
    controller.dispose();
    db.close();
  }
});

it("starts a selected training-partner session once and publishes only after confirmed hosting", async () => {
  const h = setup();
  jest.mocked(h.cloud.hostWorkout).mockImplementation(async () => {
    h.publish({ phase: "active", snapshot: server });
  });
  const r = renderWithTheme(
    <TogetherCloudContainer {...h.props} initialHost="friends" />,
  );
  await waitFor(() => expect(h.cloud.visibility).toHaveBeenCalledTimes(1));
  expect(h.cloud.hostWorkout).toHaveBeenCalledWith(h.draft);
  expect(h.cloud.visibility).toHaveBeenCalledWith(
    "friends",
    expect.any(String),
  );
  r.rerender(<TogetherCloudContainer {...h.props} initialHost="friends" />);
  expect(h.cloud.hostWorkout).toHaveBeenCalledTimes(1);
});

it("starting as Partners sends the session's end the host call just reported, not a 2-hour guess (inspector lead)", async () => {
  const h = setup();
  const endsAt = new Date(Date.now() + 3.9 * 3600_000).toISOString();
  jest.mocked(h.cloud.hostWorkout).mockImplementation(async () => {
    h.publish({ phase: "active", snapshot: { ...server, endsAt } });
  });
  renderWithTheme(
    <TogetherCloudContainer {...h.props} initialHost="friends" />,
  );
  await waitFor(() => expect(h.cloud.visibility).toHaveBeenCalledTimes(1));
  expect(h.cloud.visibility).toHaveBeenCalledWith("friends", endsAt);
});

it("preserves existing Together authority rather than hosting a second session", () => {
  const h = setup();
  h.draft.together = {
    sessionId: "existing",
    executionId: "own",
  };
  renderWithTheme(
    <TogetherCloudContainer {...h.props} initialHost="friends" />,
  );
  expect(h.cloud.hostWorkout).not.toHaveBeenCalled();
  expect(h.cloud.visibility).not.toHaveBeenCalled();
});

it.each(["account", "unmount", "background", "cancel", "partners"])(
  "does not publish friends visibility after %s interrupts hosting",
  async (reason) => {
    const h = setup();
    let finish!: () => void;
    jest.mocked(h.cloud.hostWorkout).mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    const appListener = jest.spyOn(AppState, "addEventListener");
    const r = renderWithTheme(
      <TogetherCloudContainer {...h.props} initialHost="friends" />,
    );
    await waitFor(() => expect(h.cloud.hostWorkout).toHaveBeenCalledTimes(1));
    if (reason === "account")
      r.rerender(
        <TogetherCloudContainer
          {...h.props}
          accountId="other"
          initialHost="friends"
        />,
      );
    if (reason === "unmount") r.unmount();
    if (reason === "cancel") act(() => ui(r).onCancel());
    if (reason === "partners") act(() => ui(r).onPartners());
    if (reason === "background")
      act(() => {
        appListener.mock.calls.at(-1)![1]("background");
      });
    await act(async () => {
      h.publish({ phase: "active", snapshot: server });
      finish();
    });
    expect(h.cloud.visibility).not.toHaveBeenCalled();
  },
);

it("reports publication failure while retaining the created session", async () => {
  const h = setup();
  jest.mocked(h.cloud.hostWorkout).mockImplementation(async () => {
    h.publish({ phase: "active", snapshot: server });
  });
  jest.mocked(h.cloud.visibility).mockRejectedValue(new Error("offline"));
  const r = renderWithTheme(
    <TogetherCloudContainer {...h.props} initialHost="friends" />,
  );
  await waitFor(() =>
    expect(
      r.getByText(/visibility to training partners is not confirmed/),
    ).toBeTruthy(),
  );
  expect(h.state().snapshot?.sessionId).toBe(server.sessionId);
  expect(h.cloud.cancel).not.toHaveBeenCalled();
});

it("does not publish a training-partner session before hosting is confirmed", async () => {
  const h = setup();
  const r = renderWithTheme(
    <TogetherCloudContainer {...h.props} initialHost="friends" />,
  );
  await waitFor(() =>
    expect(r.getByText(/Your session has not been confirmed/)).toBeTruthy(),
  );
  expect(h.cloud.visibility).not.toHaveBeenCalled();
  act(() => ui(r).onRetry());
  await waitFor(() => expect(h.cloud.retry).toHaveBeenCalledTimes(1));
  expect(h.cloud.hostWorkout).toHaveBeenCalledTimes(1);
});

it("shows the actual online invitation after confirmed Start and retries invitation failure without hosting twice", async () => {
  const h = setup();
  jest.mocked(h.cloud.hostWorkout).mockImplementation(async () => {
    h.publish({ phase: "active", snapshot: server });
  });
  jest.mocked(h.cloud.invite).mockRejectedValueOnce(new Error("network"));
  const r = renderWithTheme(
    <TogetherCloudContainer {...h.props} initialHost="friends" />,
  );
  await waitFor(() =>
    expect(r.getByText("Generate new invitation")).toBeTruthy(),
  );
  await waitFor(() =>
    expect(r.getByText(/invitation is not ready/)).toBeTruthy(),
  );
  expect(r.queryByText("Invite people")).toBeNull();
  await act(async () => {
    fireEvent.press(r.getByText("Generate new invitation"));
  });
  await waitFor(() => expect(r.getByText("Invite people")).toBeTruthy());
  expect(h.cloud.hostWorkout).toHaveBeenCalledTimes(1);
  expect(h.cloud.invite).toHaveBeenCalledTimes(2);
  expect(r.UNSAFE_getByType(QRCode).props.value).toBe(
    "persistencemobile://together/join?connection=online&invitation=invite",
  );
  // Canvas row 1b: a 200 pt code in its 14 pt white box, in a sheet sized to
  // that content rather than a 55 % sheet that scrolled (TestFlight 31 Oct).
  expect(r.UNSAFE_getByType(QRCode).props).toEqual(
    expect.objectContaining({ size: 200, quietZone: 0 }),
  );
  expect(mockSheetHeight).toHaveBeenLastCalledWith("content");
  expect(
    r.getByText(
      "Online · internet required · training partners join straight in",
    ),
  ).toBeTruthy();
  const share = jest
    .spyOn(Share, "share")
    .mockResolvedValue({ action: Share.sharedAction });
  fireEvent.press(r.getByText("Share code"));
  await waitFor(() =>
    expect(share).toHaveBeenCalledWith({
      url: "persistencemobile://together/join?connection=online&invitation=invite",
    }),
  );
  share.mockRestore();
  fireEvent.press(r.getByLabelText("Close"));
  expect(r.queryByText("Invite people")).toBeNull();
  expect(h.cloud.getSnapshot().phase).toBe("active");
  expect(h.cloud.cancel).not.toHaveBeenCalled();
  // The strip: Invite reopens the invitation; the cog opens row 4's sheet.
  fireEvent.press(r.getByText("Invite"));
  expect(r.getByText("Invite people")).toBeTruthy();
  fireEvent.press(r.getByLabelText("Close"));
  fireEvent.press(r.getByLabelText("Together settings"));
  expect(
    r.getByText(
      "This session only. Defaults live in Train › Together › Settings.",
    ),
  ).toBeTruthy();
  // Partners was chosen at Start.
  expect(
    r.UNSAFE_getByType(TogetherSharingPresenter).props.audience?.value,
  ).toBe("friends");
});
it("scans an online token but requires a deliberate Join and handles camera denial", async () => {
  const h = setup();
  mockCameraPermission
    .mockResolvedValueOnce({ granted: false })
    .mockResolvedValue({ granted: true });
  const r = renderWithTheme(<TogetherCloudContainer {...h.props} />);
  fireEvent.press(r.getByText("Open"));
  fireEvent.press(r.getByText("Scan online invitation"));
  await waitFor(() =>
    expect(r.getByText(/Camera permission is needed/)).toBeTruthy(),
  );
  fireEvent.press(r.getByText("Scan online invitation"));
  await waitFor(() =>
    expect(r.getByTestId("together-online-qr-camera")).toBeTruthy(),
  );
  act(() =>
    r
      .getByTestId("together-online-qr-camera")
      .props.onBarcodeScanned({ data: "server-token" }),
  );
  expect(h.cloud.join).not.toHaveBeenCalled();
  expect(ui(r).code).toBe("server-token");
  await act(async () => ui(r).onJoin());
  expect(h.cloud.join).toHaveBeenCalledWith(
    { inviteToken: "server-token" },
    h.draft,
  );
});
it("does not publish a late generated invitation or scan after lifecycle interruption", async () => {
  const h = setup();
  jest.mocked(h.cloud.hostWorkout).mockImplementation(async () => {
    h.publish({ phase: "active", snapshot: server });
  });
  let resolve!: (
    value: Awaited<ReturnType<TogetherCloudPort["invite"]>>,
  ) => void;
  jest.mocked(h.cloud.invite).mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const listener = jest.spyOn(AppState, "addEventListener");
  const r = renderWithTheme(
    <TogetherCloudContainer {...h.props} initialHost="friends" />,
  );
  await waitFor(() => expect(h.cloud.invite).toHaveBeenCalledTimes(1));
  act(() => listener.mock.calls.at(-1)![1]("background"));
  await act(async () =>
    resolve({
      tokenId: "late",
      token: "late-secret",
      expiresAt: new Date(Date.now() + 900_000).toISOString(),
    }),
  );
  expect(r.queryByText("Scan to join")).toBeNull();
  r.unmount();
  const join = setup();
  mockCameraPermission.mockResolvedValue({ granted: true });
  const page = renderWithTheme(<TogetherCloudContainer {...join.props} />);
  fireEvent.press(page.getByText("Open"));
  fireEvent.press(page.getByText("Scan online invitation"));
  await waitFor(() =>
    expect(page.getByTestId("together-online-qr-camera")).toBeTruthy(),
  );
  const scan = page.getByTestId("together-online-qr-camera").props
    .onBarcodeScanned;
  act(() => listener.mock.calls.at(-1)![1]("background"));
  act(() => scan({ data: "late-secret" }));
  expect(ui(page).code).toBe("");
  expect(join.cloud.join).not.toHaveBeenCalled();
});

it("invalidates the single-use invitation after admission and after expiry", async () => {
  const h = setup();
  jest.mocked(h.cloud.hostWorkout).mockImplementation(async () => {
    h.publish({ phase: "active", snapshot: server });
  });
  const r = renderWithTheme(
    <TogetherCloudContainer {...h.props} initialHost="friends" />,
  );
  await waitFor(() => expect(r.getByText("Invite people")).toBeTruthy());
  act(() =>
    h.publish({
      snapshot: {
        ...server,
        participants: [
          ...server.participants,
          { ...server.participants[1], userId: "new-athlete" },
        ],
      },
    }),
  );
  await waitFor(() => expect(r.queryByText("Invite people")).toBeNull());
  expect(r.getByText("Generate new invitation")).toBeTruthy();
  jest.mocked(h.cloud.invite).mockResolvedValue({
    tokenId: "next",
    token: "new-invite",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  await act(async () => {
    fireEvent.press(r.getByText("Generate new invitation"));
  });
  await waitFor(() => expect(r.getByText("Invite people")).toBeTruthy());
  expect(h.cloud.hostWorkout).toHaveBeenCalledTimes(1);
  // The QR appears on the invitation's own commit, one microtask before the
  // regenerate action releases `run`'s lock. A Share pressed in that gap is
  // dropped by design, so flush the release before pressing (CI hit the gap
  // on PR #505's run; it never reproduces locally).
  await act(async () => {});
  const now = jest.spyOn(Date, "now").mockReturnValue(Date.now() + 120_000);
  const share = jest
    .spyOn(Share, "share")
    .mockResolvedValue({ action: Share.sharedAction });
  await act(async () => {
    fireEvent.press(r.getByText("Share code"));
  });
  await waitFor(() => expect(r.queryByText("Invite people")).toBeNull());
  expect(share).not.toHaveBeenCalled();
  share.mockRestore();
  now.mockRestore();
});
it("removes the QR automatically when its server expiry is reached", async () => {
  jest.useFakeTimers();
  try {
    const h = setup();
    jest.mocked(h.cloud.hostWorkout).mockImplementation(async () => {
      h.publish({ phase: "active", snapshot: server });
    });
    jest.mocked(h.cloud.invite).mockResolvedValue({
      tokenId: "short",
      token: "short-lived",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const r = renderWithTheme(
      <TogetherCloudContainer {...h.props} initialHost="friends" />,
    );
    await waitFor(() => expect(r.getByText("Invite people")).toBeTruthy());
    act(() => jest.advanceTimersByTime(60_000));
    expect(r.queryByText("Invite people")).toBeNull();
    expect(r.getByText("Generate new invitation")).toBeTruthy();
    expect(h.cloud.invite).toHaveBeenCalledTimes(1);
    r.unmount();
  } finally {
    jest.useRealTimers();
  }
});

it("applies the stored sharing defaults to newcomers in an Online session, and to everyone on a fresh join (PER-60)", async () => {
  useTogetherSettings.setState({
    userId: "u",
    hydrated: true,
    rehydrate: jest.fn(async () => {}),
  });
  const h = setup(true);
  const r = renderWithTheme(<TogetherCloudContainer {...h.props} />);
  await act(async () => {});
  // Already logging (ownRevision 1): the people already in are left as they are.
  expect(h.cloud.numbersConsent).not.toHaveBeenCalled();
  const newcomer = { ...server.participants[1], userId: "w" };
  act(() =>
    h.publish({
      snapshot: {
        ...h.state().snapshot!,
        participants: [...h.state().snapshot!.participants, newcomer],
      },
    }),
  );
  await act(async () => {});
  expect(h.cloud.numbersConsent).toHaveBeenCalledWith(["w"]);
  expect(h.cloud.previousConsent).toHaveBeenCalledWith(["w"]);
  expect(h.cloud.delegation).not.toHaveBeenCalled();
  r.unmount();
  // A fresh join (nothing logged or granted yet) shares with everyone, and
  // fill-in follows the default too.
  useTogetherSettings.setState({
    userId: "u",
    hydrated: true,
    sharing: { numbers: true, previous: false, logging: true },
  });
  const fresh = setup(true);
  fresh.state().snapshot!.participants[0].ownRevision = 0;
  renderWithTheme(<TogetherCloudContainer {...fresh.props} />);
  await act(async () => {});
  expect(fresh.cloud.numbersConsent).toHaveBeenCalledWith(["v"]);
  expect(fresh.cloud.previousConsent).not.toHaveBeenCalled();
  expect(fresh.cloud.delegation).toHaveBeenCalledWith(true);
  useTogetherSettings.getState().reset();
});

it("leaves finished partners out of the joining defaults, so the server takes the grant (inspector lead)", async () => {
  useTogetherSettings.setState({
    userId: "u",
    hydrated: true,
    rehydrate: jest.fn(async () => {}),
    sharing: { numbers: true, previous: true, logging: false },
  });
  // A fresh join where v has already saved and w is still training.
  const h = setup(true);
  const snap = h.state().snapshot!;
  snap.participants[0].ownRevision = 0;
  snap.participants[1].status = "saved";
  snap.participants.push({ ...server.participants[1], userId: "w" });
  const r = renderWithTheme(<TogetherCloudContainer {...h.props} />);
  await act(async () => {});
  expect(h.cloud.numbersConsent).toHaveBeenCalledWith(["w"]);
  expect(h.cloud.previousConsent).toHaveBeenCalledWith(["w"]);
  // Someone joins later: the list keeps w and adds x, never the finished v,
  // even though an earlier grant still names v.
  jest.mocked(h.cloud.numbersConsent).mockClear();
  jest.mocked(h.cloud.previousConsent).mockClear();
  const own = h.state().snapshot!.participants[0];
  own.ownRevision = 1;
  own.numbersConsent = { version: 1, recipientIds: ["v", "w"] };
  own.previousConsent = { version: 1, recipientIds: ["v", "w"] };
  act(() =>
    h.publish({
      snapshot: {
        ...h.state().snapshot!,
        participants: [
          ...h.state().snapshot!.participants,
          { ...server.participants[1], userId: "x" },
        ],
      },
    }),
  );
  await act(async () => {});
  expect(h.cloud.numbersConsent).toHaveBeenCalledWith(["w", "x"]);
  expect(h.cloud.previousConsent).toHaveBeenCalledWith(["w", "x"]);
  r.unmount();
  useTogetherSettings.getState().reset();
});

it("does not re-share numbers an athlete revoked before logging when the screen remounts (inspector lead)", async () => {
  useTogetherSettings.setState({
    userId: "u",
    hydrated: true,
    rehydrate: jest.fn(async () => {}),
    sharing: { numbers: true, previous: true, logging: true },
  });
  const h = setup(true);
  const own = h.state().snapshot!.participants[0];
  own.ownRevision = 0;
  // Both lists are empty, but their versions show the athlete switched them off.
  own.numbersConsent = { version: 2, recipientIds: [] };
  own.previousConsent = { version: 1, recipientIds: [] };
  const r = renderWithTheme(<TogetherCloudContainer {...h.props} />);
  await act(async () => {});
  expect(h.cloud.numbersConsent).not.toHaveBeenCalled();
  expect(h.cloud.previousConsent).not.toHaveBeenCalled();
  expect(h.cloud.delegation).not.toHaveBeenCalled();
  // A newcomer still gets the defaults: that is a new person, not a redo.
  const newcomer = { ...server.participants[1], userId: "w" };
  act(() =>
    h.publish({
      snapshot: {
        ...h.state().snapshot!,
        participants: [...h.state().snapshot!.participants, newcomer],
      },
    }),
  );
  await act(async () => {});
  expect(h.cloud.numbersConsent).toHaveBeenCalledWith(["w"]);
  expect(h.cloud.previousConsent).toHaveBeenCalledWith(["w"]);
  r.unmount();
  useTogetherSettings.getState().reset();
});

it("grants nothing until this account's settings have been read (inspector lead 1)", async () => {
  const rehydrate = jest.fn(async () => {});
  useTogetherSettings.setState({ userId: null, hydrated: false, rehydrate });
  const h = setup(true);
  h.state().snapshot!.participants[0].ownRevision = 0;
  renderWithTheme(<TogetherCloudContainer {...h.props} />);
  await act(async () => {});
  expect(rehydrate).toHaveBeenCalledWith("u");
  expect(h.cloud.numbersConsent).not.toHaveBeenCalled();
  // The read lands with "Show my numbers" off: only previous values go out.
  act(() =>
    useTogetherSettings.setState({
      userId: "u",
      hydrated: true,
      sharing: { numbers: false, previous: true, logging: false },
    }),
  );
  await act(async () => {});
  expect(h.cloud.numbersConsent).not.toHaveBeenCalled();
  expect(h.cloud.previousConsent).toHaveBeenCalledWith(["v"]);
  useTogetherSettings.getState().reset();
});

describe("leaving and ending Online (canvas row 3)", () => {
  const guest = () => {
    const h = setup(true);
    h.state().snapshot!.participants[0]!.displayName = "Brad";
    h.state().snapshot!.participants[1]!.userId = "v";
    const props = {
      ...h.props,
      accountId: "v",
      getWorkout: () => ({ ...h.draft, userId: "v" }),
    };
    return { ...h, props };
  };
  const ended = (h: ReturnType<typeof setup>, state: "closed" | "active") =>
    act(() =>
      h.publish({
        snapshot: {
          ...h.state().snapshot!,
          state,
          sharingActive: false,
          continuation: "solo",
          participants: h
            .state()
            .snapshot!.participants.filter((x) => x.userId === "v"),
        },
      }),
    );

  it("remembers the live roster for the summary after the session closes", () => {
    forgetRoster();
    const h = guest();
    const id = h.state().snapshot!.sessionId;
    renderWithTheme(<TogetherCloudContainer {...h.props} />);
    ended(h, "closed");
    expect(rosterSeen(id)?.map((p) => p.userId)).toEqual(
      expect.arrayContaining(["v", h.state().snapshot!.hostId]),
    );
    expect(rosterSeen("another-session")).toBeNull();
  });

  it("the host's End stops sharing for everyone and the strip goes", async () => {
    const h = setup(true);
    const stop = jest.fn(async () => {});
    (h.cloud as { stopSharing?: () => Promise<void> }).stopSharing = stop;
    const r = renderWithTheme(<TogetherCloudContainer {...h.props} />);
    fireEvent.press(r.getByText("End"));
    expect(r.getByText("End the live session?")).toBeTruthy();
    await act(async () => fireEvent.press(r.getByText("End session")));
    expect(stop).toHaveBeenCalledTimes(1);
    expect(
      r.getByText("Live session ended. Your workout carries on."),
    ).toBeTruthy();
    act(() =>
      h.publish({
        snapshot: {
          ...h.state().snapshot!,
          state: "closed",
          sharingActive: false,
          continuation: "solo",
        },
      }),
    );
    expect(r.queryByText("End")).toBeNull();
    expect(r.queryByText(/Sharing ended/)).toBeNull();
  });

  it("a guest's Leave keeps their workout and does not read as the host ending", async () => {
    const h = guest();
    const stop = jest.fn(async () => {});
    (h.cloud as { stopSharing?: () => Promise<void> }).stopSharing = stop;
    const r = renderWithTheme(<TogetherCloudContainer {...h.props} />);
    fireEvent.press(r.getByText("Leave"));
    expect(r.getByText("Leave Brad’s session?")).toBeTruthy();
    expect(
      r.getByText("Your workout carries on here. Brad keeps training."),
    ).toBeTruthy();
    await act(async () =>
      fireEvent.press(r.getByTestId("together-leave-confirm")),
    );
    expect(stop).toHaveBeenCalled();
    expect(
      r.getByText("You left Brad’s session. Your workout carries on."),
    ).toBeTruthy();
    ended(h, "active");
    expect(r.queryByText(/ended the live session/)).toBeNull();
    expect(r.queryByText("Leave")).toBeNull();
  });

  it("a partner hears when the host ends it, with the host's name kept from when it was live", () => {
    const h = guest();
    const r = renderWithTheme(<TogetherCloudContainer {...h.props} />);
    ended(h, "closed");
    expect(
      r.getByText("Brad ended the live session. Your workout carries on."),
    ).toBeTruthy();
    expect(r.queryByText("Leave")).toBeNull();
  });

  it("being removed is not the host ending", () => {
    const h = guest();
    const r = renderWithTheme(<TogetherCloudContainer {...h.props} />);
    ended(h, "active");
    expect(r.queryByTestId("together-toast")).toBeNull();
  });

  it("a session already over when the screen opens says nothing", () => {
    const h = guest();
    ended(h, "closed");
    const r = renderWithTheme(<TogetherCloudContainer {...h.props} />);
    expect(r.queryByTestId("together-toast")).toBeNull();
    expect(r.queryByText("Leave")).toBeNull();
  });

  it("a failed leave keeps the session and says so", async () => {
    const h = guest();
    const r = renderWithTheme(<TogetherCloudContainer {...h.props} />);
    fireEvent.press(r.getByText("Leave"));
    fireEvent.press(r.getByTestId("together-leave-stay"));
    expect(r.queryByText("Leave Brad’s session?")).toBeNull();
    fireEvent.press(r.getByText("Leave"));
    await act(async () =>
      fireEvent.press(r.getByTestId("together-leave-confirm")),
    );
    expect(
      r.getByText(
        "Could not leave the session. Your workout is safe. Try again.",
      ),
    ).toBeTruthy();
    // Still live: the strip stays.
    expect(r.getByText("Leave")).toBeTruthy();
  });
});
