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
  expect(h.lobby.host).toHaveBeenCalledWith("Squats");
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
