import React from "react";
import {
  Alert,
  AppState,
  Share,
  View,
  type AppStateStatus,
} from "react-native";
import { act, fireEvent, waitFor } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import { TogetherLobbyContainer } from "../TogetherLobbyContainer";
import type {
  TogetherLobbyPort,
  TogetherLobbySnapshot,
} from "@/domain/ports/togetherLobby.port";
import { router } from "expo-router";
import { TogetherSharingPresenter } from "@/ui/presenters/TogetherSharingPresenter";
import { TogetherPartnerPresenter } from "@/ui/presenters/TogetherPartnerPresenter";
import { TogetherWorkoutRow } from "@/ui/presenters/TogetherWorkoutRow";
import type {
  TogetherPreviousRow,
  TogetherSharedPort,
  TogetherSharedSnapshot,
} from "@/domain/ports/togetherShared.port";
import type { TogetherCloudPort } from "@/domain/ports/togetherCloud.port";
import type { WorkoutSession } from "@/domain/models/session";
const mockCloud = jest.fn();
jest.mock("../TogetherCloudContainer", () => ({
  TogetherCloudContainer: (props: unknown) => {
    mockCloud(props);
    return null;
  },
}));
jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));
const mockSheet = jest.fn();
const mockRequest = jest.fn();
const mockCopy = jest.fn();
jest.mock("expo-camera", () => ({
  useCameraPermissions: () => [{ granted: false }, mockRequest],
  CameraView: "CameraView",
}));
jest.mock("expo-clipboard", () => ({
  setStringAsync: (text: string) => mockCopy(text),
}));
jest.mock("react-native-qrcode-svg", () => "QRCode");
jest.mock("@/ui/components/foundation/BottomSheet", () => ({
  BottomSheet: (props: {
    visible: boolean;
    children: React.ReactNode;
    footer?: React.ReactNode;
    onClose(): void;
  }) => {
    mockSheet(props);
    return props.visible ? (
      <>
        {props.children}
        {props.footer}
      </>
    ) : null;
  },
}));

function harness() {
  let snapshot: TogetherLobbySnapshot = {
    phase: "idle",
    members: [],
    pending: [],
  };
  const listeners = new Set<() => void>();
  const lobby: TogetherLobbyPort = {
    getSnapshot: () => snapshot,
    subscribe: (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    host: jest.fn(async () => {}),
    browse: jest.fn(async () => {}),
    selectDiscovered: jest.fn(async () => {}),
    selectInvite: jest.fn(async () => {}),
    join: jest.fn(async () => {}),
    approve: jest.fn(async () => {}),
    decline: jest.fn(async () => {}),
    reconnect: jest.fn(async () => {}),
    cancel: jest.fn(async () => {}),
    setOnline: jest.fn(),
    setActive: jest.fn(),
    setAccount: jest.fn(),
    dispose: jest.fn(async () => {}),
    invalidateAuthorization: jest.fn(),
  };
  return {
    lobby,
    publish: (change: Partial<TogetherLobbySnapshot>) =>
      act(() => {
        snapshot = { ...snapshot, ...change };
        listeners.forEach((l) => l());
      }),
  };
}
beforeEach(() => {
  jest
    .spyOn(AppState, "addEventListener")
    .mockReturnValue({ remove: jest.fn() });
  mockCloud.mockClear();
  jest.mocked(router.push).mockClear();
  jest.spyOn(Alert, "alert").mockImplementation(() => {});
  mockRequest.mockReset();
  mockCopy.mockReset();
  mockCopy.mockResolvedValue(undefined);
});
it("hosts current workout, approves real peer IDs, copies invite and cleans up", async () => {
  const h = harness();
  const r = renderWithTheme(
    <TogetherLobbyContainer
      lobby={h.lobby}
      workoutName="Squats"
      accountId="a"
    />,
  );
  fireEvent.press(r.getByText("Start"));
  fireEvent.press(r.getByText("Start the session"));
  expect(h.lobby.host).toHaveBeenCalledWith("Squats", "invite-only");
  h.publish({
    phase: "hosting",
    role: "host",
    invitation: "signed",
    pending: [{ userId: "g", peerId: "p" }],
  });
  await act(async () => {});
  fireEvent.press(r.getByText("Copy"));
  fireEvent.press(r.getByLabelText("Session settings"));
  expect(mockCopy).toHaveBeenCalledWith(
    "persistencemobile://together/join?connection=local&invitation=signed&transport=lan",
  );
  fireEvent.press(r.getByText("Approve"));
  expect(h.lobby.approve).toHaveBeenCalledWith("p");
  fireEvent.press(r.getByText("Decline"));
  expect(h.lobby.decline).toHaveBeenCalledWith("p");
  r.unmount();
  expect(h.lobby.cancel).not.toHaveBeenCalled();
});
it("does not apply a camera permission reply after cancellation", async () => {
  let resolve!: (v: { granted: boolean }) => void;
  mockRequest.mockReturnValue(new Promise((r) => (resolve = r)));
  const h = harness();
  const r = renderWithTheme(
    <TogetherLobbyContainer
      lobby={h.lobby}
      workoutName="Squats"
      accountId="a"
    />,
  );
  fireEvent.press(r.getByText("Start"));
  fireEvent.press(r.getByText("Join"));
  fireEvent.press(r.getByText("Scan a QR code"));
  fireEvent.press(r.getByText("Cancel · keep training on my own"));
  await act(async () => resolve({ granted: true }));
  fireEvent.press(r.getByText("Start"));
  fireEvent.press(r.getByText("Join"));
  expect(r.queryByTestId("together-qr-camera")).toBeNull();
  expect(h.lobby.selectInvite).not.toHaveBeenCalled();
});
it("camera denial allows paste; scanning verifies once, then join requires consent", async () => {
  mockRequest.mockResolvedValueOnce({ granted: false });
  const h = harness();
  const r = renderWithTheme(
    <TogetherLobbyContainer
      lobby={h.lobby}
      workoutName="Squats"
      accountId="a"
    />,
  );
  fireEvent.press(r.getByText("Start"));
  fireEvent.press(r.getByText("Join"));
  fireEvent.press(r.getByText("Scan a QR code"));
  await waitFor(() =>
    expect(r.getByText(/Paste the invitation instead/)).toBeTruthy(),
  );
  fireEvent.changeText(r.getByLabelText("Session invitation"), "signed");
  fireEvent.press(r.getByText("Continue"));
  expect(h.lobby.selectInvite).toHaveBeenCalledWith("signed");
  expect(h.lobby.join).not.toHaveBeenCalled();
  mockRequest.mockResolvedValueOnce({ granted: true });
  fireEvent.press(r.getByText("Scan a QR code"));
  const camera = await r.findByTestId("together-qr-camera");
  act(() => {
    camera.props.onBarcodeScanned({ data: "qr-invite" });
    camera.props.onBarcodeScanned({ data: "duplicate" });
  });
  expect(h.lobby.selectInvite).toHaveBeenLastCalledWith("qr-invite");
  expect(h.lobby.selectInvite).toHaveBeenCalledTimes(2);
  h.publish({ phase: "selected" });
  fireEvent.press(r.getByText("Join the lobby"));
  expect(h.lobby.join).toHaveBeenCalledTimes(1);
  h.publish({ phase: "reconnecting" });
  fireEvent.press(r.getByText("Reconnect"));
  expect(h.lobby.reconnect).toHaveBeenCalledTimes(1);
});
it("account replacement clears input; late failures cannot reappear", async () => {
  let reject!: (e: Error) => void;
  const h = harness();
  jest
    .mocked(h.lobby.host)
    .mockReturnValueOnce(new Promise((_, r) => (reject = r)));
  const r = renderWithTheme(
    <TogetherLobbyContainer
      lobby={h.lobby}
      workoutName="Squats"
      accountId="a"
    />,
  );
  fireEvent.press(r.getByText("Start"));
  fireEvent.press(r.getByText("Start the session"));
  r.rerender(
    <TogetherLobbyContainer
      lobby={h.lobby}
      workoutName="Squats"
      accountId="b"
    />,
  );
  await act(async () => reject(Error("late")));
  fireEvent.press(r.getByText("Start"));
  expect(r.queryByText(/Could not complete this action/)).toBeNull();
  jest.mocked(h.lobby.host).mockRejectedValueOnce(Error("now"));
  fireEvent.press(r.getByText("Start the session"));
  await waitFor(() =>
    expect(r.getByText(/Could not finish preparing Together/)).toBeTruthy(),
  );
  h.publish({ phase: "disabled" });
  expect(r.queryByTestId("together-workout-row")).toBeNull();
});

it("dismissing the root sheet preserves admission; explicit Leave terminates it", () => {
  const h = harness();
  const r = renderWithTheme(
    <TogetherLobbyContainer lobby={h.lobby} workoutName="Squats" accountId="a">
      {(row) => <View testID="workout-header">{row}</View>}
    </TogetherLobbyContainer>,
  );
  fireEvent.press(r.getByText("Start"));
  h.publish({ phase: "hosting" });
  expect(
    r
      .getByTestId("workout-header")
      .findAllByProps({ testID: "together-lobby-content" }),
  ).toHaveLength(0);
  act(() => mockSheet.mock.calls.at(-1)![0].onClose());
  expect(h.lobby.cancel).not.toHaveBeenCalled();
  fireEvent.press(r.getByText("Open"));
  fireEvent.press(r.getByText("Leave lobby · keep my workout"));
  expect(h.lobby.cancel).toHaveBeenCalledTimes(1);
  h.publish({ phase: "disabled" });
  expect(r.getByTestId("workout-header")).toBeTruthy();
});
it("background invalidates idle scanning and delayed camera permission", async () => {
  let lifecycle!: (state: AppStateStatus) => void;
  const subscription = jest
    .spyOn(AppState, "addEventListener")
    .mockImplementation((_, listener) => {
      lifecycle = listener;
      return { remove: jest.fn() };
    });
  let resolve!: (v: { granted: boolean }) => void;
  mockRequest.mockResolvedValueOnce({ granted: true });
  const h = harness();
  const r = renderWithTheme(
    <TogetherLobbyContainer
      lobby={h.lobby}
      workoutName="Squats"
      accountId="a"
    />,
  );
  fireEvent.press(r.getByText("Start"));
  fireEvent.press(r.getByText("Join"));
  fireEvent.press(r.getByText("Scan a QR code"));
  await r.findByTestId("together-qr-camera");
  act(() => lifecycle("background"));
  expect(r.queryByTestId("together-qr-camera")).toBeNull();
  act(() => lifecycle("active"));
  fireEvent.press(r.getByText("Start"));
  fireEvent.press(r.getByText("Join"));
  mockRequest.mockReturnValueOnce(new Promise((r) => (resolve = r)));
  fireEvent.press(r.getByText("Scan a QR code"));
  act(() => lifecycle("background"));
  await act(async () => resolve({ granted: true }));
  act(() => lifecycle("active"));
  fireEvent.press(r.getByText("Start"));
  fireEvent.press(r.getByText("Join"));
  expect(r.queryByTestId("together-qr-camera")).toBeNull();
  r.unmount();
  subscription.mockRestore();
});
it("passes explicit audience and resets private on account change", () => {
  const h = harness();
  const r = renderWithTheme(
    <TogetherLobbyContainer
      lobby={h.lobby}
      workoutName="Squats"
      accountId="a"
    />,
  );
  fireEvent.press(r.getByText("Start"));
  fireEvent.press(r.getByRole("radio", { name: "Open on this network" }));
  fireEvent.press(r.getByText("Start the session"));
  expect(h.lobby.host).toHaveBeenLastCalledWith("Squats", "open");
  r.rerender(
    <TogetherLobbyContainer
      lobby={h.lobby}
      workoutName="Squats"
      accountId="b"
    />,
  );
  fireEvent.press(r.getByText("Start"));
  fireEvent.press(r.getByText("Start the session"));
  expect(h.lobby.host).toHaveBeenLastCalledWith("Squats", "invite-only");
});
it("browses, selects, and requires a separate Join; dismiss then retains admitted lobby", () => {
  const h = harness();
  const r = renderWithTheme(
    <TogetherLobbyContainer
      lobby={h.lobby}
      workoutName="Squats"
      accountId="a"
    />,
  );
  fireEvent.press(r.getByText("Start"));
  fireEvent.press(r.getByText("Join"));
  fireEvent.press(r.getByText("Find an open lobby on this network"));
  expect(h.lobby.browse).toHaveBeenCalledTimes(1);
  h.publish({
    phase: "browsing",
    discovered: [
      {
        sessionId: "s",
        hostUserId: "h",
        workoutName: "Pull day",
        memberCount: 1,
      },
    ],
  });
  fireEvent.press(r.getByText("View lobby"));
  expect(h.lobby.selectDiscovered).toHaveBeenCalledWith("s");
  expect(h.lobby.join).not.toHaveBeenCalled();
  h.publish({ phase: "selected" });
  fireEvent.press(r.getByText("Join the lobby"));
  expect(h.lobby.join).toHaveBeenCalledTimes(1);
  h.publish({ phase: "joined" });
  act(() => mockSheet.mock.calls.at(-1)![0].onClose());
  expect(h.lobby.cancel).not.toHaveBeenCalled();
});
it("dismiss stops an in-flight browse preparation; code fallback cancels discovery", () => {
  const h = harness();
  const r = renderWithTheme(
    <TogetherLobbyContainer
      lobby={h.lobby}
      workoutName="Squats"
      accountId="a"
    />,
  );
  fireEvent.press(r.getByText("Start"));
  fireEvent.press(r.getByText("Join"));
  fireEvent.press(r.getByText("Find an open lobby on this network"));
  h.publish({ phase: "preparing" });
  act(() => mockSheet.mock.calls.at(-1)![0].onClose());
  expect(h.lobby.cancel).toHaveBeenCalledTimes(1);
  h.publish({ phase: "idle" });
  fireEvent.press(r.getByText("Start"));
  fireEvent.press(r.getByText("Join"));
  fireEvent.press(r.getByText("Find an open lobby on this network"));
  h.publish({ phase: "browsing" });
  fireEvent.press(r.getByText("Use a code or QR instead"));
  expect(h.lobby.cancel).toHaveBeenCalledTimes(2);
  h.publish({ phase: "idle" });
  expect(r.getByLabelText("Session invitation")).toBeTruthy();
  act(() => mockSheet.mock.calls.at(-1)![0].onClose());
  expect(h.lobby.cancel).toHaveBeenCalledTimes(2);
});

it("cancelled browsing cannot make a later host dismissal leave the lobby", async () => {
  const h = harness();
  const r = renderWithTheme(
    <TogetherLobbyContainer
      lobby={h.lobby}
      workoutName="Squats"
      accountId="a"
    />,
  );
  fireEvent.press(r.getByText("Start"));
  fireEvent.press(r.getByText("Join"));
  fireEvent.press(r.getByText("Find an open lobby on this network"));
  h.publish({ phase: "browsing" });
  fireEvent.press(r.getByText("Cancel · keep training on my own"));
  expect(h.lobby.cancel).toHaveBeenCalledTimes(1);
  h.publish({ phase: "idle" });
  fireEvent.press(r.getByText("Start"));
  fireEvent.press(r.getByText("Start the session"));
  h.publish({ phase: "hosting" });
  await act(async () => {});
  act(() => mockSheet.mock.calls.at(-1)![0].onClose());
  expect(h.lobby.cancel).toHaveBeenCalledTimes(1);
});

it("starting discovery invalidates a camera permission response before preparation settles", async () => {
  const h = harness();
  let resolve!: (value: { granted: boolean }) => void;
  mockRequest.mockReturnValue(new Promise((r) => (resolve = r)));
  const r = renderWithTheme(
    <TogetherLobbyContainer
      lobby={h.lobby}
      workoutName="Squats"
      accountId="a"
    />,
  );
  fireEvent.press(r.getByText("Start"));
  fireEvent.press(r.getByText("Join"));
  fireEvent.press(r.getByText("Scan a QR code"));
  fireEvent.press(r.getByText("Find an open lobby on this network"));
  await act(async () => resolve({ granted: true }));
  expect(h.lobby.browse).toHaveBeenCalledTimes(1);
  expect(r.queryByTestId("together-qr-camera")).toBeNull();
});

function workoutHarness() {
  const h = harness();
  const listeners = new Set<() => void>();
  let status:
    | import("@/domain/ports/togetherWorkout.port").TogetherWorkoutStatus
    | null = null;
  const workout: import("@/domain/ports/togetherWorkout.port").TogetherWorkoutPort =
    {
      getActive: jest.fn(),
      getPlan: jest.fn(),
      getOwnExecution: jest.fn(),
      applyOwnOperation: jest.fn(),
      review: jest.fn(),
      getReview: jest.fn(),
      finish: jest.fn(),
      promote: jest.fn(async () => {}),
      read: jest.fn(),
      save: jest.fn(),
      status: jest.fn((account, id) =>
        account === "a" && id === "local" ? status : null,
      ),
      subscribe: (l) => {
        listeners.add(l);
        return () => {
          listeners.delete(l);
        };
      },
    };
  return {
    ...h,
    lobby: { ...h.lobby, workout },
    workout,
    listeners,
    update: (
      sharing: import("@/domain/ports/togetherWorkout.port").TogetherWorkoutStatus["sharing"],
      receivedCount = 0,
    ) =>
      act(() => {
        status = {
          sessionId: "s",
          executionId: "e",
          localSessionId: "local",
          sharing,
          receivedCount,
          pendingCount: 2 - receivedCount,
        };
        listeners.forEach((l) => l());
      }),
  };
}
it("promotes only on consent using the fresh workout and shows durable receipt updates", async () => {
  const h = workoutHarness();
  const current: import("@/domain/models/session").WorkoutSession = {
    id: "local",
    userId: "a",
    workoutId: null,
    name: "Latest name",
    status: "in_progress",
    startedAt: "2026-10-04T09:00:00Z",
    completedAt: null,
    notes: null,
    exercises: [],
  };
  const getWorkout = jest.fn(() => current);
  const r = renderWithTheme(
    <TogetherLobbyContainer
      lobby={h.lobby}
      workoutName="Old name"
      accountId="a"
      localSessionId="local"
      getWorkout={getWorkout}
    />,
  );
  fireEvent.press(r.getByText("Start"));
  h.publish({ phase: "pending-approval" });
  expect(r.queryByText("Use my workout in Together")).toBeNull();
  expect(getWorkout).not.toHaveBeenCalled();
  h.publish({ phase: "joined" });
  expect(h.workout.promote).not.toHaveBeenCalled();
  fireEvent.press(r.getByText("Use my workout in Together"));
  expect(h.workout.promote).toHaveBeenCalledWith(current);
  h.update("active", 1);
  expect(r.getByText(/complete workout journal is retained/)).toBeTruthy();
  expect(r.queryByText(/Your workout remains personal/)).toBeNull();
  h.publish({ phase: "idle" });
  h.update("local-only");
  expect(r.queryByText("Start the session")).toBeNull();
  expect(r.queryByText("Join")).toBeNull();
  expect(
    r.getByText(/My workout · Sharing ended · continue your workout/),
  ).toBeTruthy();
  r.rerender(
    <TogetherLobbyContainer
      lobby={h.lobby}
      workoutName="Other"
      accountId="b"
      localSessionId="local"
      getWorkout={getWorkout}
    />,
  );
  expect(r.queryByText(/My workout ·/)).toBeNull();
  expect(r.getByText("Start")).toBeTruthy();
  r.unmount();
  expect(h.listeners.size).toBe(0);
});
it("rejects a changed personal workout and explains unsupported promotion without hiding logging", async () => {
  const h = workoutHarness();
  const getWorkout = jest.fn<
    ReturnType<
      NonNullable<
        React.ComponentProps<typeof TogetherLobbyContainer>["getWorkout"]
      >
    >,
    []
  >(() => null);
  const r = renderWithTheme(
    <TogetherLobbyContainer
      lobby={h.lobby}
      workoutName="Squats"
      accountId="a"
      localSessionId="local"
      getWorkout={getWorkout}
    />,
  );
  fireEvent.press(r.getByText("Start"));
  h.publish({ phase: "hosting" });
  fireEvent.press(r.getByText("Use my workout in Together"));
  await r.findByText(/Could not complete this action/);
  expect(h.workout.promote).not.toHaveBeenCalled();
  const session: import("@/domain/models/session").WorkoutSession = {
    id: "changed",
    userId: "a",
    workoutId: null,
    name: "Squats",
    status: "in_progress",
    startedAt: "2026-10-04T09:00:00Z",
    completedAt: null,
    notes: null,
    exercises: [],
  };
  getWorkout.mockReturnValue(session);
  fireEvent.press(r.getByText("Use my workout in Together"));
  await r.findByText(/Could not complete this action/);
  session.id = "local";
  session.userId = "b";
  fireEvent.press(r.getByText("Use my workout in Together"));
  await r.findByText(/Could not complete this action/);
  expect(h.workout.promote).not.toHaveBeenCalled();
  session.userId = "a";
  jest
    .mocked(h.workout.promote)
    .mockRejectedValueOnce(Error("workout-unsupported"));
  fireEvent.press(r.getByText("Use my workout in Together"));
  await r.findByText(/This workout can’t be shared yet/);
  expect(r.getByText("Leave lobby · keep my workout")).toBeTruthy();
});

const plan = {
  name: "Shared plan",
  exercises: [
    { planExerciseId: "p", exerciseId: "squat", order: 0, targetSets: 3 },
  ],
};
const personal = (): WorkoutSession => ({
  id: "local",
  userId: "a",
  workoutId: null,
  name: "My workout",
  status: "in_progress",
  startedAt: "2026-10-05T09:00:00Z",
  completedAt: null,
  notes: null,
  exercises: [
    {
      id: "squat-slot",
      sessionId: "local",
      exerciseId: "squat",
      exerciseName: "Squat",
      sortOrder: 0,
      supersetGroup: null,
      isSubstituted: false,
      originalExerciseId: null,
      notes: null,
      sets: [],
    },
  ],
});
function sharingHarness() {
  const h = workoutHarness();
  let view: TogetherSharedSnapshot = {
    progress: [],
    plan,
    planHash: "hash",
    athletePlans: {},
    profiles: { other: "Mia" },
    athletes: [],
    previous: {},
    grants: [],
    closures: [],
    delegated: [],
    deliveries: [],
  };
  const shared: TogetherSharedPort = {
    getSnapshot: () => view,
    subscribe: () => () => {},
    publishOwnActivity: jest.fn(async () => {}),
    publishPlan: jest.fn(async () => {}),
    publishProfile: jest.fn(async () => {}),
    setOwnPlan: jest.fn(),
    setConsent: jest.fn(async () => {}),
    publishPrevious: jest.fn(async () => {}),
    requestDelegatedSet: jest.fn(async () => {}),
    consumeDelegated: jest.fn(),
    close: jest.fn(async () => {}),
  };
  const lobby: TogetherLobbyPort = {
    ...h.lobby,
    shared,
    removeParticipant: jest.fn(async () => {}),
    transports: ["lan", "nearby", "hotspot-owner"],
    selectTransport: jest.fn(),
  };
  return {
    ...h,
    lobby,
    shared,
    setShared: (next: Partial<TogetherSharedSnapshot>) => {
      view = { ...view, ...next };
      h.publish({});
    },
  };
}
function mountShared(
  h: ReturnType<typeof sharingHarness>,
  extra: Partial<React.ComponentProps<typeof TogetherLobbyContainer>> = {},
) {
  return renderWithTheme(
    <TogetherLobbyContainer
      lobby={h.lobby}
      workoutName="Mine"
      accountId="a"
      localSessionId="local"
      getWorkout={() => personal()}
      {...extra}
    />,
  );
}
function shareProps(r: ReturnType<typeof renderWithTheme>) {
  return r.UNSAFE_getByType(TogetherSharingPresenter)
    .props as React.ComponentProps<typeof TogetherSharingPresenter>;
}
function lastDialog() {
  return jest.mocked(Alert.alert).mock.calls.at(-1)![2]!;
}
it("selects explicit transports and switches to remote only after local cancellation", async () => {
  const h = sharingHarness(),
    cloud = {} as TogetherCloudPort;
  const r = mountShared(h, { cloud });
  fireEvent.press(r.getByText("Start"));
  fireEvent.press(r.getByText("Nearby phones"));
  fireEvent.press(r.getByText("This Android phone’s hotspot"));
  fireEvent.press(r.getByText("Same Wi-Fi or hotspot"));
  expect(h.lobby.selectTransport).toHaveBeenNthCalledWith(1, "nearby");
  expect(h.lobby.selectTransport).toHaveBeenNthCalledWith(2, "hotspot-owner");
  expect(h.lobby.selectTransport).toHaveBeenNthCalledWith(3, "lan");
  let finish!: () => void;
  jest.mocked(h.lobby.cancel).mockReturnValueOnce(
    new Promise((r) => {
      finish = r;
    }),
  );
  fireEvent.press(r.getByLabelText("Training partners"));
  fireEvent.press(r.getByText("Online · internet required"));
  fireEvent.press(r.getByText("Start the session"));
  expect(mockCloud).not.toHaveBeenCalled();
  await act(async () => finish());
  expect(mockCloud).toHaveBeenCalledWith(
    expect.objectContaining({ cloud, accountId: "a" }),
  );
  act(() => mockCloud.mock.calls.at(-1)![0].onLocal());
  expect(r.getByText("Start the session")).toBeTruthy();
});
it("late cancellation cannot switch another account to the remote flow", async () => {
  const h = sharingHarness(),
    cloud = {} as TogetherCloudPort;
  let finish!: () => void;
  jest.mocked(h.lobby.cancel).mockReturnValueOnce(
    new Promise((r) => {
      finish = r;
    }),
  );
  const r = mountShared(h, { cloud });
  fireEvent.press(r.getByText("Start"));
  fireEvent.press(r.getByLabelText("Training partners"));
  fireEvent.press(r.getByText("Online · internet required"));
  fireEvent.press(r.getByText("Start the session"));
  r.rerender(
    <TogetherLobbyContainer
      lobby={h.lobby}
      cloud={cloud}
      accountId="b"
      workoutName="Other"
      getWorkout={() => ({ ...personal(), userId: "b" })}
    />,
  );
  await act(async () => finish());
  expect(mockCloud).not.toHaveBeenCalled();
  expect(r.getByText("Start")).toBeTruthy();
});
it("restores a cloud-owned workout directly and forwards personal restoration", () => {
  const h = sharingHarness(),
    cloud = {} as TogetherCloudPort,
    onRestorePersonal = jest.fn(),
    session = {
      ...personal(),
      together: {
        sessionId: "s",
        executionId: "e",
        transport: "cloud" as const,
      },
    };
  mountShared(h, { cloud, getWorkout: () => session, onRestorePersonal });
  expect(mockCloud).toHaveBeenCalledWith(
    expect.objectContaining({ cloud, onRestorePersonal }),
  );
  expect(h.lobby.host).not.toHaveBeenCalled();
});
it("scopes PREV publication to explicit recipient, current owner and workout start", async () => {
  const h = sharingHarness(),
    getPrevious = jest.fn(() => [
      {
        exerciseId: "squat",
        setNumber: 1,
        reps: 8,
        weightKg: 60,
        recordedAt: 1,
      },
    ]);
  const r = mountShared(h, { getPrevious });
  fireEvent.press(r.getByText("Start"));
  h.publish({
    phase: "hosting",
    role: "host",
    members: [
      { userId: "a", host: true },
      { userId: "other", host: false },
    ],
  });
  await act(async () =>
    shareProps(r).onConsent("other", {
      numbers: false,
      prev: true,
      logging: false,
    }),
  );
  expect(h.shared.setConsent).toHaveBeenCalledWith("other", {
    numbers: false,
    prev: true,
    logging: false,
  });
  expect(h.shared.publishPrevious).toHaveBeenCalledWith(
    "other",
    getPrevious(),
    Date.parse(personal().startedAt),
  );
  jest.mocked(h.shared.publishPrevious).mockClear();
  await act(async () =>
    shareProps(r).onConsent("other", {
      numbers: true,
      prev: false,
      logging: true,
    }),
  );
  expect(h.shared.publishPrevious).not.toHaveBeenCalled();
});
it("does not publish PREV after a delayed grant crosses accounts", async () => {
  const h = sharingHarness();
  let finish!: () => void;
  jest.mocked(h.shared.setConsent).mockReturnValueOnce(
    new Promise((r) => {
      finish = r;
    }),
  );
  const getPrevious = jest.fn(() => []);
  const r = mountShared(h, { getPrevious });
  fireEvent.press(r.getByText("Start"));
  h.publish({ phase: "hosting", role: "host" });
  act(() =>
    shareProps(r).onConsent("other", {
      numbers: true,
      prev: true,
      logging: false,
    }),
  );
  r.rerender(
    <TogetherLobbyContainer
      lobby={h.lobby}
      accountId="b"
      workoutName="Other"
      getWorkout={() => ({ ...personal(), userId: "b" })}
      getPrevious={getPrevious}
    />,
  );
  await act(async () => finish());
  expect(getPrevious).not.toHaveBeenCalled();
  expect(h.shared.publishPrevious).not.toHaveBeenCalled();
});
it("never reads PREV from a draft belonging to another account", async () => {
  const h = sharingHarness(),
    getPrevious = jest.fn(() => []);
  const r = mountShared(h, {
    getWorkout: () => ({ ...personal(), userId: "b" }),
    getPrevious,
  });
  fireEvent.press(r.getByText("Start"));
  h.publish({ phase: "hosting", role: "host" });
  await act(async () =>
    shareProps(r).onConsent("other", {
      numbers: false,
      prev: true,
      logging: false,
    }),
  );
  expect(getPrevious).not.toHaveBeenCalled();
});
it("publishes the chosen display name only while admitted and tolerates failed profile delivery", async () => {
  const h = sharingHarness();
  jest.mocked(h.shared.publishProfile).mockRejectedValue(new Error("offline"));
  mountShared(h, { displayName: "Brad" });
  expect(h.shared.publishProfile).not.toHaveBeenCalled();
  await act(async () => h.publish({ phase: "joined" }));
  expect(h.shared.publishProfile).toHaveBeenCalledWith("Brad");
});
it("adopts an offered plan deliberately and never offers replacement over logged sets", async () => {
  const h = sharingHarness(),
    onAdoptPlan = jest.fn();
  const r = mountShared(h, { onAdoptPlan });
  fireEvent.press(r.getByText("Start"));
  h.publish({ phase: "joined", role: "guest" });
  expect(onAdoptPlan).not.toHaveBeenCalled();
  fireEvent.press(r.getByText("Add their plan to mine"));
  expect(onAdoptPlan).toHaveBeenLastCalledWith(plan, "append");
  fireEvent.press(r.getByText("Use this plan"));
  expect(onAdoptPlan).toHaveBeenLastCalledWith(plan, "replace-empty");
  const session = personal();
  session.exercises = [
    {
      id: "x",
      sessionId: "local",
      exerciseId: "squat",
      exerciseName: "Squat",
      sortOrder: 0,
      supersetGroup: null,
      isSubstituted: false,
      originalExerciseId: null,
      notes: null,
      sets: [
        {
          id: "set",
          sessionExerciseId: "x",
          setNumber: 1,
          weightKg: 60,
          reps: 8,
          rpe: null,
          durationSeconds: null,
          distanceMeters: null,
          isCompleted: true,
          completedAt: null,
        },
      ],
    },
  ];
  r.rerender(
    <TogetherLobbyContainer
      lobby={h.lobby}
      workoutName="Mine"
      accountId="a"
      getWorkout={() => session}
      onAdoptPlan={onAdoptPlan}
    />,
  );
  expect(r.queryByText("Use this plan")).toBeNull();
  expect(r.getByText("Add their plan to mine")).toBeTruthy();
});
it("promotes and publishes only the current host plan; guests keep their own plan", async () => {
  const h = sharingHarness();
  jest.mocked(h.workout.getPlan).mockReturnValue(plan);
  const r = mountShared(h);
  fireEvent.press(r.getByText("Start"));
  h.publish({ phase: "hosting", role: "host" });
  await act(async () =>
    fireEvent.press(r.getByText("Use my workout in Together")),
  );
  expect(h.shared.setOwnPlan).toHaveBeenCalledWith(plan);
  expect(h.shared.publishPlan).toHaveBeenCalledWith(plan);
  jest.mocked(h.shared.publishPlan).mockClear();
  h.publish({ phase: "joined", role: "guest" });
  await act(async () =>
    fireEvent.press(r.getByText("Use my workout in Together")),
  );
  expect(h.shared.publishPlan).not.toHaveBeenCalled();
});
it("does not publish an old account's plan after delayed promotion", async () => {
  const h = sharingHarness();
  let finish!: () => void;
  jest.mocked(h.workout.promote).mockReturnValueOnce(
    new Promise((r) => {
      finish = r;
    }),
  );
  jest.mocked(h.workout.getPlan).mockReturnValue(plan);
  const r = mountShared(h);
  fireEvent.press(r.getByText("Start"));
  h.publish({ phase: "hosting", role: "host" });
  fireEvent.press(r.getByText("Use my workout in Together"));
  r.rerender(
    <TogetherLobbyContainer
      lobby={h.lobby}
      accountId="b"
      workoutName="Other"
      getWorkout={() => ({ ...personal(), userId: "b" })}
    />,
  );
  await act(async () => finish());
  expect(h.shared.setOwnPlan).not.toHaveBeenCalled();
  expect(h.shared.publishPlan).not.toHaveBeenCalled();
});
it("partner view delegates only the displayed revision and returns to own workout on removal", async () => {
  const h = sharingHarness();
  const r = mountShared(h, {
    displayName: "Brad",
    children: (row) => <View testID="personal-workout">{row}</View>,
  });
  h.publish({
    phase: "joined",
    members: [
      { userId: "a", host: false },
      { userId: "other", host: true },
    ],
  });
  h.update("active");
  fireEvent.press(r.getByLabelText("View Mia’s workout"));
  expect(r.queryByTestId("personal-workout")).toBeNull();
  const p = r.UNSAFE_getByType(TogetherPartnerPresenter)
    .props as React.ComponentProps<typeof TogetherPartnerPresenter>;
  await act(async () => p.onOperation({ type: "upsertSet" }, 7));
  expect(h.shared.requestDelegatedSet).toHaveBeenCalledWith(
    "other",
    { type: "upsertSet" },
    7,
  );
  act(() => p.onMine());
  expect(r.getByTestId("personal-workout")).toBeTruthy();
  fireEvent.press(r.getByLabelText("View Mia’s workout"));
  h.publish({ members: [{ userId: "a", host: false }] });
  expect(r.getByTestId("personal-workout")).toBeTruthy();
});
it("destructive dialogs are generation-bound and do nothing when dismissed", async () => {
  const h = sharingHarness();
  const r = mountShared(h);
  fireEvent.press(r.getByText("Start"));
  h.publish({
    phase: "hosting",
    role: "host",
    members: [
      { userId: "a", host: true },
      { userId: "other", host: false },
    ],
  });
  act(() => shareProps(r).onRemove!("other"));
  expect(h.lobby.removeParticipant).not.toHaveBeenCalled();
  const oldRemove = lastDialog().find((b) => b.text === "Remove")!;
  r.rerender(
    <TogetherLobbyContainer
      lobby={h.lobby}
      accountId="b"
      workoutName="Other"
    />,
  );
  await act(async () => oldRemove.onPress!());
  expect(h.lobby.removeParticipant).not.toHaveBeenCalled();
  fireEvent.press(r.getByText("Open"));
  act(() => shareProps(r).onClose("finish_all"));
  const oldClose = lastDialog().find((b) => b.text === "End sharing")!;
  r.unmount();
  await act(async () => oldClose.onPress!());
  expect(h.shared.close).not.toHaveBeenCalled();
});
it("confirms removal and routes an acknowledged closure to own recovery", async () => {
  const h = sharingHarness();
  const r = mountShared(h);
  fireEvent.press(r.getByText("Start"));
  h.publish({
    phase: "hosting",
    role: "host",
    members: [
      { userId: "a", host: true },
      { userId: "other", host: false },
    ],
  });
  act(() => shareProps(r).onRemove!("other"));
  await act(async () =>
    lastDialog().find((b) => b.text === "Remove")!.onPress!(),
  );
  expect(h.lobby.removeParticipant).toHaveBeenCalledWith("other");
  act(() => shareProps(r).onClose("save_own"));
  expect(h.shared.close).not.toHaveBeenCalled();
  await act(async () =>
    lastDialog().find((b) => b.text === "End sharing")!.onPress!(),
  );
  expect(h.shared.close).toHaveBeenCalledWith("save_own");
  expect(router.push).not.toHaveBeenCalled();
});
it("late closure cannot navigate or cancel a newer account's lobby", async () => {
  const h = sharingHarness();
  let finish!: () => void;
  jest.mocked(h.shared.close).mockReturnValueOnce(
    new Promise((r) => {
      finish = r;
    }),
  );
  const r = mountShared(h);
  fireEvent.press(r.getByText("Start"));
  h.publish({ phase: "hosting", role: "host" });
  act(() => shareProps(r).onClose("finish_all"));
  act(() => lastDialog().find((b) => b.text === "End sharing")!.onPress!());
  r.rerender(
    <TogetherLobbyContainer
      lobby={h.lobby}
      accountId="b"
      workoutName="Other"
    />,
  );
  await act(async () => finish());
  expect(router.push).not.toHaveBeenCalled();
  jest.mocked(h.shared.close).mockReturnValueOnce(
    new Promise((r) => {
      finish = r;
    }),
  );
  fireEvent.press(r.getByText("Open"));
  fireEvent.press(r.getByText("Leave lobby · keep my workout"));
  r.rerender(
    <TogetherLobbyContainer
      lobby={h.lobby}
      accountId="c"
      workoutName="Third"
    />,
  );
  const cancellations = jest.mocked(h.lobby.cancel).mock.calls.length;
  await act(async () => finish());
  expect(h.lobby.cancel).toHaveBeenCalledTimes(cancellations);
});
it("explicit leave signals shared closure before cancelling; review and partner navigation dismiss locally", async () => {
  const h = sharingHarness();
  const r = mountShared(h);
  fireEvent.press(r.getByText("Start"));
  h.publish({ phase: "joined", role: "guest" });
  await act(async () =>
    fireEvent.press(r.getByText("Leave lobby · keep my workout")),
  );
  expect(h.shared.close).toHaveBeenCalledWith("leave");
  expect(h.lobby.cancel).toHaveBeenCalled();
  fireEvent.press(r.getByText("Open"));
  h.update("active");
  fireEvent.press(r.getByText("Review my result"));
  expect(router.push).toHaveBeenLastCalledWith({
    pathname: "/(app)/session/together-review",
    params: { localSessionId: "local" },
  });
  fireEvent.press(r.getByText("Open"));
  fireEvent.press(r.getByText("Training partners"));
  expect(router.push).toHaveBeenLastCalledWith("/(app)/together/partners");
});

it("workout row opens settings and end controls while self selection restores the personal view", () => {
  const h = sharingHarness();
  const r = mountShared(h);
  h.publish({
    phase: "joined",
    role: "guest",
    members: [
      { userId: "a", host: true },
      { userId: "b", host: false },
    ],
  });
  h.update("active");
  const row = () => r.UNSAFE_getByType(TogetherWorkoutRow).props;
  act(() => row().onSettings());
  expect(r.getByText("Training partners")).toBeTruthy();
  act(() => row().onSelect("b"));
  expect(r.UNSAFE_getByType(TogetherPartnerPresenter)).toBeTruthy();
  act(() => row().onSelect("a"));
  expect(r.UNSAFE_queryByType(TogetherPartnerPresenter)).toBeNull();
  act(() => row().onEnd());
  expect(r.getByText("Leave sharing · keep my workout")).toBeTruthy();
});

it("warms own history after local admission without gating lobby or sharing without consent", async () => {
  const h = sharingHarness();
  const refreshPrevious = jest.fn<
    Promise<readonly TogetherPreviousRow[]>,
    [() => boolean]
  >(async () => []);
  const r = mountShared(h, { refreshPrevious });
  fireEvent.press(r.getByText("Start"));
  h.publish({ phase: "hosting", role: "host" });
  await act(async () => {});
  expect(refreshPrevious).toHaveBeenCalledTimes(1);
  expect(refreshPrevious.mock.calls[0]![0]()).toBe(true);
  expect(h.shared.publishPrevious).not.toHaveBeenCalled();
  r.unmount();
  expect(refreshPrevious.mock.calls[0]![0]()).toBe(false);
});

it.each(["current", "revoked", "regranted", "workout", "unmounted"])(
  "refreshes consented PREV only for the unchanged grant: %s",
  async (state) => {
    const h = sharingHarness();
    const refreshed = [
      {
        exerciseId: "squat",
        setNumber: 1,
        reps: 8,
        weightKg: 80,
        recordedAt: 1,
      },
    ];
    const refreshPrevious = jest.fn<
      Promise<readonly TogetherPreviousRow[]>,
      [() => boolean]
    >(async () => []);
    let workout = personal();
    const r = mountShared(h, {
      refreshPrevious,
      getPrevious: () => [],
      getWorkout: () => workout,
    });
    fireEvent.press(r.getByText("Start"));
    h.publish({ phase: "hosting", role: "host" });
    await act(async () => {});
    let resolve!: (rows: readonly TogetherPreviousRow[]) => void;
    refreshPrevious.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const grant = {
      ownerId: "a",
      recipientId: "other",
      version: 1,
      consent: { prev: true, numbers: false, logging: false },
    };
    h.setShared({ grants: [grant] });
    await act(async () => {
      shareProps(r).onConsent("other", grant.consent);
    });
    expect(h.shared.publishPrevious).toHaveBeenCalledWith(
      "other",
      [],
      Date.parse(workout.startedAt),
    );
    if (state === "revoked") {
      h.setShared({
        grants: [
          { ...grant, version: 2, consent: { ...grant.consent, prev: false } },
        ],
      });
      await act(async () => {
        shareProps(r).onConsent("other", { ...grant.consent, prev: false });
      });
    }
    if (state === "regranted")
      h.setShared({ grants: [{ ...grant, version: 3 }] });
    if (state === "workout") workout = { ...workout, id: "another" };
    if (state === "unmounted") r.unmount();
    await act(async () => resolve(refreshed));
    expect(h.shared.publishPrevious).toHaveBeenCalledTimes(
      state === "current" ? 2 : 1,
    );
    if (state === "current")
      expect(h.shared.publishPrevious).toHaveBeenLastCalledWith(
        "other",
        refreshed,
        Date.parse(workout.startedAt),
      );
  },
);

it("omits skipped PREV in cached and refreshed publication, using the current workout on resend", async () => {
  const h = sharingHarness();
  const squat = personal().exercises[0]!;
  let workout = {
    ...personal(),
    exercises: [
      { ...squat, skipped: true },
      { ...squat, id: "press-slot", exerciseId: "press", skipped: false },
      { ...squat, id: "row-slot", exerciseId: "row", skipped: false },
    ],
  };
  const rows = ["squat", "press", "row"].map((exerciseId) => ({
    exerciseId,
    setNumber: 1,
    reps: 8,
    weightKg: 60,
    recordedAt: 1,
  }));
  const refreshPrevious = jest.fn<
    Promise<readonly TogetherPreviousRow[]>,
    [() => boolean]
  >(async () => []);
  const r = mountShared(h, {
    getWorkout: () => workout,
    getPrevious: () => rows,
    refreshPrevious,
  });
  fireEvent.press(r.getByText("Start"));
  h.publish({ phase: "hosting", role: "host" });
  await act(async () => {});
  let resolve!: (value: readonly TogetherPreviousRow[]) => void;
  refreshPrevious.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const consent = { prev: true, numbers: false, logging: false };
  h.setShared({
    grants: [{ ownerId: "a", recipientId: "other", version: 1, consent }],
  });
  await act(async () => {
    shareProps(r).onConsent("other", consent);
  });
  expect(h.shared.publishPrevious).toHaveBeenLastCalledWith(
    "other",
    rows.slice(1),
    Date.parse(workout.startedAt),
  );
  workout = {
    ...workout,
    exercises: workout.exercises.map((e) =>
      e.exerciseId === "row" ? { ...e, skipped: true } : e,
    ),
  };
  await act(async () => resolve(rows.map((row) => ({ ...row, weightKg: 80 }))));
  expect(h.shared.publishPrevious).toHaveBeenLastCalledWith(
    "other",
    [{ ...rows[1], weightKg: 80 }],
    Date.parse(workout.startedAt),
  );
  r.unmount();
});

it("consumes a detail host intent once and does not restart after an error or cancellation", async () => {
  const h = harness();
  const consume = jest.fn();
  jest.mocked(h.lobby.host).mockRejectedValueOnce(new Error("unavailable"));
  const r = renderWithTheme(
    <TogetherLobbyContainer
      lobby={h.lobby}
      accountId="me"
      workoutName="Squats"
      initialHostAudience="open"
      onConsumeHostIntent={consume}
    />,
  );
  await waitFor(() => expect(h.lobby.host).toHaveBeenCalledTimes(1));
  expect(h.lobby.host).toHaveBeenCalledWith("Squats", "open");
  expect(consume).toHaveBeenCalledTimes(1);
  await waitFor(() =>
    expect(
      r.getByText(
        "Could not finish preparing Together. Your workout stays on this device. Open settings to retry sharing or review your result.",
      ),
    ).toBeTruthy(),
  );
  act(() => mockSheet.mock.calls.at(-1)![0].onClose());
  h.publish({ phase: "idle" });
  expect(h.lobby.host).toHaveBeenCalledTimes(1);
});

it.each(["ready", "cancel", "account"])(
  "defers detail hosting while preparing and handles %s",
  (outcome) => {
    const h = harness();
    h.publish({ phase: "preparing" });
    const consume = jest.fn();
    const render = (accountId: string) => (
      <TogetherLobbyContainer
        lobby={h.lobby}
        accountId={accountId}
        workoutName="Squats"
        initialHostAudience="open"
        onConsumeHostIntent={consume}
      />
    );
    const r = renderWithTheme(render("me"));
    expect(h.lobby.host).not.toHaveBeenCalled();
    if (outcome === "cancel")
      act(() => mockSheet.mock.calls.at(-1)![0].onClose());
    if (outcome === "account") {
      r.rerender(render("other"));
      r.rerender(render("me"));
    }
    h.publish({ phase: "idle" });
    expect(h.lobby.host).toHaveBeenCalledTimes(outcome === "ready" ? 1 : 0);
  },
);

it.each(["cloud", "local"] as const)(
  "does not auto-host over an existing %s workout checkpoint",
  (transport) => {
    const h = harness();
    const consume = jest.fn();
    const session: WorkoutSession = {
      ...personal(),
      together: {
        sessionId: "owned",
        executionId: "own-execution",
        ...(transport === "cloud" ? { transport: "cloud" as const } : {}),
      },
    };
    renderWithTheme(
      <TogetherLobbyContainer
        lobby={h.lobby}
        accountId="a"
        workoutName="Squats"
        cloud={{} as TogetherCloudPort}
        getWorkout={() => session}
        initialHostAudience="open"
        onConsumeHostIntent={consume}
      />,
    );
    expect(h.lobby.host).not.toHaveBeenCalled();
    expect(consume).toHaveBeenCalledTimes(1);
    expect(session.together?.sessionId).toBe("owned");
    if (transport === "cloud") expect(mockCloud).toHaveBeenCalled();
  },
);

it("background consumes a pending detail host intent before preparation completes", () => {
  let lifecycle!: (state: AppStateStatus) => void;
  jest.spyOn(AppState, "addEventListener").mockImplementation((_, callback) => {
    lifecycle = callback;
    return { remove: jest.fn() };
  });
  const h = harness();
  h.publish({ phase: "preparing" });
  const consume = jest.fn();
  renderWithTheme(
    <TogetherLobbyContainer
      lobby={h.lobby}
      accountId="a"
      workoutName="Squats"
      initialHostAudience="open"
      onConsumeHostIntent={consume}
    />,
  );
  act(() => lifecycle("background"));
  expect(consume).toHaveBeenCalledTimes(1);
  h.publish({ phase: "idle" });
  act(() => lifecycle("active"));
  expect(h.lobby.host).not.toHaveBeenCalled();
  expect(mockSheet.mock.calls.at(-1)![0].visible).toBe(false);
});

it("starts online training partners only after explicit connection selection", async () => {
  const h = sharingHarness(),
    cloud = {} as TogetherCloudPort;
  const r = mountShared(h, { cloud });
  fireEvent.press(r.getByText("Start"));
  fireEvent.press(r.getByLabelText("Training partners"));
  fireEvent.press(r.getByText("Online · internet required"));
  fireEvent.press(r.getByText("Start the session"));
  await waitFor(() =>
    expect(mockCloud).toHaveBeenCalledWith(
      expect.objectContaining({ cloud, initialHostFriends: true }),
    ),
  );
  expect(h.lobby.host).not.toHaveBeenCalled();
});

it("routes a training-partners detail intent independently of local credential preparation", async () => {
  const h = sharingHarness(),
    cloud = {} as TogetherCloudPort;
  h.publish({ phase: "preparing" });
  const consume = jest.fn();
  mountShared(h, {
    cloud,
    initialHostAudience: "friends",
    initialHostConnection: "online",
    onConsumeHostIntent: consume,
  });
  await waitFor(() =>
    expect(mockCloud).toHaveBeenCalledWith(
      expect.objectContaining({ cloud, initialHostFriends: true }),
    ),
  );
  expect(consume).toHaveBeenCalledTimes(1);
  expect(h.lobby.host).not.toHaveBeenCalled();
});

it("hosts partners locally by default without contacting cloud", async () => {
  const h = sharingHarness();
  const r = mountShared(h, { cloud: {} as TogetherCloudPort });
  fireEvent.press(r.getByText("Start"));
  fireEvent.press(r.getByLabelText("Training partners"));
  fireEvent.press(r.getByText("Start the session"));
  expect(h.lobby.host).toHaveBeenCalledWith("Mine", "friends");
  expect(mockCloud).not.toHaveBeenCalled();
});
it("waits for credentials then hosts local partner detail intent", () => {
  const h = sharingHarness();
  h.publish({ phase: "preparing" });
  const consume = jest.fn();
  mountShared(h, {
    initialHostAudience: "friends",
    onConsumeHostIntent: consume,
  });
  expect(h.lobby.host).not.toHaveBeenCalled();
  h.publish({ phase: "idle" });
  expect(h.lobby.host).toHaveBeenCalledWith("Mine", "friends");
  expect(consume).toHaveBeenCalledTimes(1);
  expect(mockCloud).not.toHaveBeenCalled();
});

it("keeps online discovery available to a joiner without hosting", async () => {
  const h = sharingHarness();
  const cloud = {} as TogetherCloudPort;
  const r = mountShared(h, { cloud });
  fireEvent.press(r.getByText("Start"));
  fireEvent.press(r.getByText("Join"));
  fireEvent.press(r.getByText("Browse online sessions"));
  await waitFor(() =>
    expect(mockCloud).toHaveBeenCalledWith(
      expect.objectContaining({ cloud, initialHostFriends: false }),
    ),
  );
  expect(h.lobby.host).not.toHaveBeenCalled();
});

it("starts and promotes the detail workout before showing the actual invitation, and Back preserves it", async () => {
  const h = sharingHarness();
  jest.mocked(h.workout.getPlan).mockReturnValue(plan);
  jest.mocked(h.lobby.host).mockImplementation(async () => {
    h.publish({
      phase: "hosting",
      role: "host",
      invitation: "signed-real-payload",
    });
  });
  const share = jest
    .spyOn(Share, "share")
    .mockResolvedValue({ action: "sharedAction" });
  const r = mountShared(h, { initialHostAudience: "invite-only" });
  await waitFor(() => expect(r.getByText("Scan to join")).toBeTruthy());
  expect(h.workout.promote).toHaveBeenCalledWith(
    expect.objectContaining({ id: "local", userId: "a" }),
  );
  expect(h.shared.publishPlan).toHaveBeenCalledWith(plan);
  expect(mockSheet.mock.calls.at(-1)![0].title).toBe("Session is live");
  expect(r.UNSAFE_getByType("QRCode" as never).props.value).toBe(
    "persistencemobile://together/join?connection=local&invitation=signed-real-payload&transport=lan",
  );
  fireEvent.press(r.getByText("Copy"));
  fireEvent.press(r.getByText("Share"));
  expect(mockCopy).toHaveBeenCalledWith(
    "persistencemobile://together/join?connection=local&invitation=signed-real-payload&transport=lan",
  );
  expect(share).toHaveBeenCalledWith({
    url: "persistencemobile://together/join?connection=local&invitation=signed-real-payload&transport=lan",
  });
  fireEvent.press(r.getByText("Back to my workout"));
  expect(mockSheet.mock.calls.at(-1)![0].visible).toBe(false);
  expect(h.lobby.cancel).not.toHaveBeenCalled();
  fireEvent.press(r.getByText("Open"));
  fireEvent.press(r.getByLabelText("Session settings"));
  expect(mockSheet.mock.calls.at(-1)![0].title).toBe("Together settings");
  expect(r.getByText("Show session invitation")).toBeTruthy();
  share.mockRestore();
});

it.each(["hosting-fails", "promotion-fails", "cancelled"])(
  "does not claim a live shared session when %s",
  async (outcome) => {
    const h = sharingHarness();
    let release!: () => void;
    jest.mocked(h.lobby.host).mockImplementation(async () => {
      if (outcome === "cancelled")
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      h.publish({
        phase: outcome === "hosting-fails" ? "unavailable" : "hosting",
        role: "host",
        invitation: "signed",
        error: outcome === "hosting-fails" ? "network" : undefined,
      });
    });
    if (outcome === "promotion-fails")
      jest
        .mocked(h.workout.promote)
        .mockRejectedValue(new Error("workout-unsupported"));
    const r = mountShared(h, { initialHostAudience: "invite-only" });
    if (outcome === "cancelled") {
      act(() => mockSheet.mock.calls.at(-1)![0].onClose());
      await act(async () => release());
    } else await act(async () => {});
    expect(r.queryByText("Scan to join")).toBeNull();
    if (outcome === "cancelled")
      expect(mockSheet.mock.calls.at(-1)![0].visible).toBe(false);
    else
      expect(mockSheet.mock.calls.at(-1)![0].title).not.toBe("Session is live");
    if (outcome !== "promotion-fails")
      expect(h.workout.promote).not.toHaveBeenCalled();
  },
);

it("retries failed host plan publication after promotion without hosting or promoting twice", async () => {
  const h = sharingHarness();
  jest.mocked(h.workout.getPlan).mockReturnValue(plan);
  jest.mocked(h.lobby.host).mockImplementation(async () => {
    h.publish({ phase: "hosting", role: "host", invitation: "signed" });
  });
  jest.mocked(h.workout.promote).mockImplementation(async () => {
    h.update("active");
  });
  jest.mocked(h.shared.publishPlan).mockRejectedValueOnce(new Error("network"));
  const r = mountShared(h, { initialHostAudience: "invite-only" });
  await waitFor(() =>
    expect(r.getByText("Retry sharing my workout")).toBeTruthy(),
  );
  expect(r.queryByText("Scan to join")).toBeNull();
  fireEvent.press(r.getByText("Retry sharing my workout"));
  await waitFor(() => expect(r.getByText("Scan to join")).toBeTruthy());
  expect(h.lobby.host).toHaveBeenCalledTimes(1);
  expect(h.workout.promote).toHaveBeenCalledTimes(1);
  expect(h.shared.publishPlan).toHaveBeenCalledTimes(2);
});

it.each(["existing-authority", "wrong-account"])(
  "refuses to replace %s before starting a local host",
  async (reason) => {
    const h = sharingHarness();
    const draft = personal();
    if (reason === "existing-authority")
      draft.together = { sessionId: "kept", executionId: "own" };
    else draft.userId = "other";
    const r = mountShared(h, { getWorkout: () => draft });
    fireEvent.press(r.getByText("Start"));
    fireEvent.press(r.getByText("Start the session"));
    await r.findByText(/Could not finish preparing Together/);
    expect(h.lobby.host).not.toHaveBeenCalled();
    expect(h.workout.promote).not.toHaveBeenCalled();
  },
);

it("does not expose new sharing or consume a host action when entry access is denied", () => {
  const h = harness();
  const r = renderWithTheme(
    <TogetherLobbyContainer
      lobby={h.lobby}
      accountId="me"
      workoutName="My workout"
      allowNewSharing={false}
      initialHostAudience="invite-only"
    >
      {(row) => <View testID="personal-workout">{row}</View>}
    </TogetherLobbyContainer>,
  );
  expect(r.getByTestId("personal-workout")).toBeTruthy();
  expect(r.queryByTestId("together-workout-row")).toBeNull();
  expect(r.queryByText("Start the session")).toBeNull();
  expect(h.lobby.host).not.toHaveBeenCalled();
  expect(h.lobby.browse).not.toHaveBeenCalled();
});

it("keeps one startup screen across host cleanup, credentials and workout promotion", async () => {
  const h = sharingHarness();
  let finishHost!: () => void;
  let finishPromotion!: () => void;
  jest.mocked(h.lobby.host).mockImplementation(async () => {
    await new Promise<void>((resolve) => {
      finishHost = resolve;
    });
  });
  jest.mocked(h.workout.promote).mockReturnValue(
    new Promise<void>((resolve) => {
      finishPromotion = resolve;
    }),
  );
  jest.mocked(h.workout.getPlan).mockReturnValue(plan);
  const r = mountShared(h, { initialHostAudience: "invite-only" });
  expect(r.getByTestId("together-starting")).toBeTruthy();
  expect(r.queryByText("Start the session")).toBeNull();
  h.publish({ phase: "preparing" });
  expect(mockSheet.mock.calls.at(-1)![0].title).toBe("Starting Together");
  h.publish({ phase: "hosting", role: "host", invitation: "signed" });
  await act(async () => finishHost());
  await waitFor(() => expect(h.workout.promote).toHaveBeenCalledTimes(1));
  expect(mockSheet.mock.calls.at(-1)![0].title).toBe("Starting Together");
  expect(r.queryByText("Use my workout in Together")).toBeNull();
  expect(r.queryByText("Scan to join")).toBeNull();
  await act(async () => finishPromotion());
  await waitFor(() => expect(r.getByText("Scan to join")).toBeTruthy());
  expect(h.lobby.host).toHaveBeenCalledTimes(1);
});

it.each(["button", "swipe"])(
  "cancels native startup through %s without reopening when hosting settles",
  async (mode) => {
    const h = sharingHarness();
    let finishHost!: () => void;
    jest.mocked(h.lobby.host).mockImplementation(async () => {
      await new Promise<void>((resolve) => {
        finishHost = resolve;
      });
    });
    const consume = jest.fn();
    const r = mountShared(h, {
      initialHostAudience: "invite-only",
      onConsumeHostIntent: consume,
    });
    h.publish({ phase: "preparing" });
    if (mode === "button")
      fireEvent.press(r.getByText("Cancel · keep my workout"));
    else act(() => mockSheet.mock.calls.at(-1)![0].onClose());
    await waitFor(() => expect(h.lobby.cancel).toHaveBeenCalledTimes(1));
    h.publish({ phase: "hosting", role: "host", invitation: "signed" });
    await act(async () => finishHost());
    expect(mockSheet.mock.calls.at(-1)![0].visible).toBe(false);
    expect(h.workout.promote).not.toHaveBeenCalled();
    expect(h.lobby.host).toHaveBeenCalledTimes(1);
  },
);

it("leaves startup honestly when credential preparation becomes unavailable", () => {
  const h = sharingHarness();
  h.publish({ phase: "preparing" });
  const r = mountShared(h, { initialHostAudience: "invite-only" });
  expect(r.getByTestId("together-starting")).toBeTruthy();
  h.publish({ phase: "unavailable", error: "expired" });
  expect(r.queryByTestId("together-starting")).toBeNull();
  expect(mockSheet.mock.calls.at(-1)![0].title).toBe("Train together");
  expect(h.lobby.host).not.toHaveBeenCalled();
});

it("preserves permission interruption during hosting until the workout and plan are published", async () => {
  let lifecycle!: (state: AppStateStatus) => void;
  jest.spyOn(AppState, "addEventListener").mockImplementation((_, callback) => {
    lifecycle = callback;
    return { remove: jest.fn() };
  });
  const h = sharingHarness();
  let finishHost!: () => void;
  jest.mocked(h.lobby.host).mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finishHost = resolve;
      }),
  );
  jest.mocked(h.workout.getPlan).mockReturnValue(plan);
  const r = mountShared(h, { initialHostAudience: "invite-only" });
  h.publish({ phase: "preparing" });
  act(() => lifecycle("inactive"));
  act(() => lifecycle("active"));
  h.publish({ phase: "hosting", role: "host", invitation: "signed" });
  await act(async () => finishHost());
  await waitFor(() => expect(h.workout.promote).toHaveBeenCalledTimes(1));
  expect(h.shared.publishPlan).toHaveBeenCalledWith(plan);
  expect(r.getByText("Scan to join")).toBeTruthy();
});
