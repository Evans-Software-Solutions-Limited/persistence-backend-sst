import React from "react";
import { AppState, View, type AppStateStatus } from "react-native";
import { act, fireEvent, waitFor } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import { TogetherLobbyContainer } from "../TogetherLobbyContainer";
import type {
  TogetherLobbyPort,
  TogetherLobbySnapshot,
} from "@/domain/ports/togetherLobby.port";
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
    onClose(): void;
  }) => {
    mockSheet(props);
    return props.visible ? props.children : null;
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
  mockRequest.mockReset();
  mockCopy.mockReset();
  mockCopy.mockResolvedValue(undefined);
});
it("hosts current workout, approves real peer IDs, copies invite and cleans up", () => {
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
  fireEvent.press(r.getByText("Copy invitation"));
  expect(mockCopy).toHaveBeenCalledWith("signed");
  fireEvent.press(r.getByText("Approve"));
  expect(h.lobby.approve).toHaveBeenCalledWith("p");
  fireEvent.press(r.getByText("Decline"));
  expect(h.lobby.decline).toHaveBeenCalledWith("p");
  r.unmount();
  expect(h.lobby.cancel).toHaveBeenCalled();
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
  fireEvent.press(r.getByText("Join"));
  fireEvent.press(r.getByText("Scan a QR code"));
  fireEvent.press(r.getByText("Cancel · keep training on my own"));
  await act(async () => resolve({ granted: true }));
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
    expect(r.getByText(/Could not complete this action/)).toBeTruthy(),
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
  fireEvent.press(r.getByText("Join"));
  fireEvent.press(r.getByText("Scan a QR code"));
  await r.findByTestId("together-qr-camera");
  act(() => lifecycle("background"));
  expect(r.queryByTestId("together-qr-camera")).toBeNull();
  act(() => lifecycle("active"));
  fireEvent.press(r.getByText("Join"));
  mockRequest.mockReturnValueOnce(new Promise((r) => (resolve = r)));
  fireEvent.press(r.getByText("Scan a QR code"));
  act(() => lifecycle("background"));
  await act(async () => resolve({ granted: true }));
  act(() => lifecycle("active"));
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
  fireEvent.press(r.getByText("Join"));
  fireEvent.press(r.getByText("Find an open lobby on this network"));
  h.publish({ phase: "preparing" });
  act(() => mockSheet.mock.calls.at(-1)![0].onClose());
  expect(h.lobby.cancel).toHaveBeenCalledTimes(1);
  h.publish({ phase: "idle" });
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

it("cancelled browsing cannot make a later host dismissal leave the lobby", () => {
  const h = harness();
  const r = renderWithTheme(
    <TogetherLobbyContainer
      lobby={h.lobby}
      workoutName="Squats"
      accountId="a"
    />,
  );
  fireEvent.press(r.getByText("Join"));
  fireEvent.press(r.getByText("Find an open lobby on this network"));
  h.publish({ phase: "browsing" });
  fireEvent.press(r.getByText("Cancel · keep training on my own"));
  expect(h.lobby.cancel).toHaveBeenCalledTimes(1);
  h.publish({ phase: "idle" });
  fireEvent.press(r.getByText("Start"));
  fireEvent.press(r.getByText("Start the session"));
  h.publish({ phase: "hosting" });
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
  expect(r.getByText(/Changes received by another athlete: 1/)).toBeTruthy();
  expect(r.queryByText(/Your workout remains personal/)).toBeNull();
  h.publish({ phase: "idle" });
  h.update("local-only");
  expect(r.queryByText("Start the session")).toBeNull();
  expect(r.queryByText("Join")).toBeNull();
  expect(
    r.getByText(/My workout · Saved locally · sharing ended/),
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
