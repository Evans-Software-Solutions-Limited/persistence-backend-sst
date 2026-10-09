import React from "react";
import { AppState } from "react-native";
import { act, fireEvent, waitFor } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import { TogetherJoinContainer } from "../TogetherJoinContainer";
import { TogetherLobbyPresenter } from "../../presenters/TogetherLobbyPresenter";
let mockHasLobby = true,
  mockHasCloud = true;
let mockUser = "u",
  mockParams: any = {},
  mockActive: any = null,
  mockState: any,
  mockCloudState: any;
const mockRouter = { back: jest.fn(), replace: jest.fn() },
  mockRequest = jest.fn(),
  mockReread = jest.fn();
const mockStorage = {
  getActiveSession: jest.fn(() => mockActive),
  cacheActiveSession: jest.fn(),
  getCachedExercises: () => [],
};
const mockLobby: any = {
  getSnapshot: () => mockState,
  subscribe: () => () => {},
  cancel: jest.fn(async () => {}),
  selectTransport: jest.fn(),
  selectInvite: jest.fn(async () => {}),
  join: jest.fn(async () => {}),
  browse: jest.fn(async () => {}),
  selectDiscovered: jest.fn(async () => {}),
  reconnect: jest.fn(async () => {}),
  workout: { promote: jest.fn(async () => {}) },
  shared: {
    getSnapshot: () => ({
      plan: {
        name: "Push",
        exercises: [
          {
            planExerciseId: "22222222-2222-4222-8222-222222222222",
            exerciseId: "33333333-3333-4333-8333-333333333333",
            order: 0,
            targetSets: 1,
          },
        ],
      },
    }),
  },
};
const mockCloudDraft = jest.fn();
const mockCloud: any = {
  getSnapshot: () => mockCloudState,
  subscribe: () => () => {},
  join: jest.fn(async () => {}),
  readDraft: () => mockCloudDraft(),
};
jest.mock("@/ui/hooks/useAdapters", () => ({
  useAdapters: () => ({
    storage: mockStorage,
    togetherLobby: mockHasLobby ? mockLobby : undefined,
    togetherCloud: mockHasCloud ? mockCloud : undefined,
  }),
}));
jest.mock("@/ui/hooks/useActiveSession", () => ({
  useActiveSession: () => ({
    userId: mockUser,
    session: mockActive,
    rereadCache: mockReread,
  }),
}));
let mockAllowed = true;
jest.mock("@/ui/hooks/useTogetherGate", () => ({
  useTogetherGate: () => ({
    allowed: mockAllowed,
    state: mockAllowed ? "allowed" : "locked",
    onUpgrade: jest.fn(),
    retry: jest.fn(),
  }),
}));
jest.mock("expo-router", () => ({
  router: {
    back: (...a: any[]) => mockRouter.back(...a),
    replace: (...a: any[]) => mockRouter.replace(...a),
  },
  useLocalSearchParams: () => mockParams,
}));
jest.mock("expo-camera", () => ({
  CameraView: jest.requireActual("react-native").View,
  useCameraPermissions: () => [{ granted: false }, mockRequest],
}));
let mockId = 0;
jest.mock("expo-crypto", () => ({
  randomUUID: () =>
    `11111111-1111-4111-8111-${String(++mockId).padStart(12, "0")}`,
}));
const mockStart = jest.fn();
jest.mock("@/application/commands/session", () => ({
  startSessionCommand: (...args: any[]) => mockStart(...args),
}));
beforeEach(() => {
  jest.clearAllMocks();
  mockHasLobby = true;
  mockHasCloud = true;
  jest
    .spyOn(AppState, "addEventListener")
    .mockImplementation(() => ({ remove: jest.fn() }));
  mockUser = "u";
  mockParams = {};
  mockActive = null;
  mockAllowed = true;
  mockState = { phase: "idle", members: [], pending: [] };
  mockCloudState = {
    phase: "idle",
    requests: [],
    previous: {},
    pendingCount: 0,
  };
  mockCloudDraft.mockReturnValue(null);
  mockRequest.mockResolvedValue({ granted: true });
  mockStart.mockReturnValue({
    ok: true,
    value: {
      id: "new-own",
      userId: "u",
      status: "in_progress",
      exercises: [],
      name: "Workout",
    },
  });
});
const lobbyProps = (r: any) => r.UNSAFE_getByType(TogetherLobbyPresenter).props;
it("opens a signed OS invitation for review without joining or creating a workout", async () => {
  mockParams = { connection: "local", invitation: "signed", transport: "lan" };
  const r = renderWithTheme(<TogetherJoinContainer />);
  await waitFor(() =>
    expect(mockLobby.selectInvite).toHaveBeenCalledWith("signed"),
  );
  expect(mockLobby.join).not.toHaveBeenCalled();
  expect(mockStart).not.toHaveBeenCalled();
  act(() => lobbyProps(r).onJoin());
  await waitFor(() => expect(mockLobby.join).toHaveBeenCalledTimes(1));
  r.unmount();
  expect(mockLobby.cancel).not.toHaveBeenCalled();
});
it("preserves an existing live workout on an incoming invitation", async () => {
  mockActive = { id: "own", together: { transport: "lan" } };
  mockParams = { connection: "local", invitation: "signed" };
  const r = renderWithTheme(<TogetherJoinContainer />);
  await act(async () => {});
  expect(mockLobby.selectInvite).not.toHaveBeenCalled();
  expect(mockStorage.cacheActiveSession).not.toHaveBeenCalled();
  fireEvent.press(r.getByText("Back to my workout"));
  expect(mockRouter.replace).toHaveBeenCalledWith("/(app)/session");
});
it("shows a bounded real camera and ignores duplicate QR callbacks", async () => {
  const r = renderWithTheme(<TogetherJoinContainer />);
  act(() => lobbyProps(r).onScan());
  await waitFor(() =>
    expect(r.getByTestId("together-join-camera")).toBeTruthy(),
  );
  const scan = r.getByTestId("together-join-camera").props.onBarcodeScanned;
  act(() => {
    scan({
      data: "persistencemobile://together/join?connection=local&invitation=signed",
    });
    scan({ data: "ignored" });
  });
  await waitFor(() => expect(mockLobby.selectInvite).toHaveBeenCalledTimes(1));
  expect(mockLobby.join).not.toHaveBeenCalled();
  expect(r.queryByTestId("together-join-camera")).toBeNull();
});
it.each(["background", "account", "unmount"])(
  "ignores permission approval after %s",
  async (reason) => {
    let resolve!: (v: any) => void;
    mockRequest.mockReturnValue(new Promise((r) => (resolve = r)));
    const listener = jest.spyOn(AppState, "addEventListener");
    const r = renderWithTheme(<TogetherJoinContainer />);
    act(() => lobbyProps(r).onScan());
    if (reason === "account") {
      mockUser = "other";
      r.rerender(<TogetherJoinContainer />);
    } else if (reason === "unmount") r.unmount();
    else act(() => listener.mock.calls.at(-1)![1]("background"));
    await act(async () => resolve({ granted: true }));
    if (reason !== "unmount")
      expect(r.queryByTestId("together-join-camera")).toBeNull();
    r.unmount();
    listener.mockRestore();
  },
);
it("keeps permission inactivity nonterminal and gives denial a paste fallback", async () => {
  mockRequest.mockResolvedValue({ granted: false });
  const r = renderWithTheme(<TogetherJoinContainer />);
  act(() => lobbyProps(r).onScan());
  await waitFor(() => expect(lobbyProps(r).notice).toContain("paste"));
  expect(r.queryByTestId("together-join-camera")).toBeNull();
});
it("requires deliberate online Join after link selection", async () => {
  mockParams = { connection: "online", invitation: "online-token" };
  const r = renderWithTheme(<TogetherJoinContainer />);
  await act(async () => {});
  expect(mockCloud.join).not.toHaveBeenCalled();
  fireEvent.press(r.getByText("Join"));
  await waitFor(() =>
    expect(mockCloud.join).toHaveBeenCalledWith(
      { inviteToken: "online-token" },
      undefined,
    ),
  );
});
it("promotes a separately chosen shared workout only after admission", async () => {
  mockState = { phase: "joined", members: [{ userId: "u" }], pending: [] };
  const r = renderWithTheme(<TogetherJoinContainer />);
  fireEvent.press(r.getByText("Use shared workout"));
  await waitFor(() =>
    expect(mockLobby.workout.promote).toHaveBeenCalledWith(
      expect.objectContaining({ id: "new-own", name: "Push" }),
    ),
  );
  expect(mockRouter.replace).toHaveBeenCalledWith("/(app)/session");
});
it("rejects retained callbacks after an account changes and blocks unpaid admission", async () => {
  const r = renderWithTheme(<TogetherJoinContainer />),
    old = lobbyProps(r);
  mockUser = "other";
  r.rerender(<TogetherJoinContainer />);
  act(() => old.onJoin());
  expect(mockLobby.join).not.toHaveBeenCalled();
  mockAllowed = false;
  r.rerender(<TogetherJoinContainer />);
  expect(r.getByText("View subscriptions")).toBeTruthy();
});
it("reports malformed scans without creating a workout", async () => {
  const r = renderWithTheme(<TogetherJoinContainer />);
  act(() => lobbyProps(r).onScan());
  await waitFor(() =>
    expect(r.getByTestId("together-join-camera")).toBeTruthy(),
  );
  act(() =>
    r
      .getByTestId("together-join-camera")
      .props.onBarcodeScanned({ data: "https://bad" }),
  );
  await waitFor(() =>
    expect(lobbyProps(r).notice).toContain("Could not connect"),
  );
  expect(mockStart).not.toHaveBeenCalled();
});
it("supports manual review, discovery, reconnect and deliberate lobby cancellation", async () => {
  const r = renderWithTheme(<TogetherJoinContainer />);
  act(() => lobbyProps(r).onCodeChange("signed"));
  act(() => lobbyProps(r).onSelect());
  await waitFor(() =>
    expect(mockLobby.selectInvite).toHaveBeenCalledWith("signed"),
  );
  await act(async () => lobbyProps(r).onBrowse());
  await act(async () => lobbyProps(r).onSelectDiscovered("verified"));
  await act(async () => lobbyProps(r).onReconnect());
  await act(async () => lobbyProps(r).onUseInvitation());
  expect(mockLobby.browse).toHaveBeenCalled();
  expect(mockLobby.selectDiscovered).toHaveBeenCalledWith("verified");
  expect(mockLobby.reconnect).toHaveBeenCalled();
  await act(async () => lobbyProps(r).onCancel());
  expect(mockRouter.back).toHaveBeenCalled();
});
it("cancels an opened camera and keeps permission inactivity nonterminal", async () => {
  const listener = jest.spyOn(AppState, "addEventListener");
  const r = renderWithTheme(<TogetherJoinContainer />);
  act(() => lobbyProps(r).onScan());
  await waitFor(() =>
    expect(r.getByTestId("together-join-camera")).toBeTruthy(),
  );
  act(() => listener.mock.calls.at(-1)![1]("inactive"));
  expect(r.getByTestId("together-join-camera")).toBeTruthy();
  fireEvent.press(r.getByText("Cancel scanning"));
  expect(r.queryByTestId("together-join-camera")).toBeNull();
  fireEvent.press(r.getByText("Back"));
  expect(mockRouter.back).toHaveBeenCalled();
  r.unmount();
  listener.mockRestore();
});
it("opens the camera from the hub scan route without admitting", async () => {
  mockParams = { scan: "true" };
  const r = renderWithTheme(<TogetherJoinContainer />);
  await waitFor(() =>
    expect(r.getByTestId("together-join-camera")).toBeTruthy(),
  );
  expect(mockLobby.join).not.toHaveBeenCalled();
});
it("does not select an invitation after cancellation switches accounts", async () => {
  mockState = { phase: "browsing", members: [], pending: [] };
  let release!: () => void;
  mockLobby.cancel.mockReturnValueOnce(new Promise<void>((r) => (release = r)));
  const r = renderWithTheme(<TogetherJoinContainer />);
  act(() => lobbyProps(r).onCodeChange("signed"));
  act(() => lobbyProps(r).onSelect());
  await act(async () => {});
  mockUser = "other";
  r.rerender(<TogetherJoinContainer />);
  await act(async () => release());
  expect(mockLobby.selectInvite).not.toHaveBeenCalled();
});
it("can keep its existing workout or append an admitted shared plan with sets preserved", async () => {
  mockState = { phase: "joined", members: [{ userId: "u" }], pending: [] };
  mockActive = {
    id: "own",
    userId: "u",
    status: "in_progress",
    exercises: [
      { id: "old-exercise", sets: [{ id: "old-set" }], sortOrder: 0 },
    ],
  };
  const r = renderWithTheme(<TogetherJoinContainer />);
  fireEvent.press(r.getByText("Keep my own workout"));
  await waitFor(() =>
    expect(mockLobby.workout.promote).toHaveBeenCalledWith(mockActive),
  );
  await act(async () => {});
  fireEvent.press(r.getByText("Add shared plan to my workout"));
  await waitFor(() =>
    expect(mockStorage.cacheActiveSession).toHaveBeenCalledWith(
      "u",
      expect.objectContaining({
        exercises: expect.arrayContaining([mockActive.exercises[0]]),
      }),
    ),
  );
  expect(mockStart).not.toHaveBeenCalled();
  await act(async () => {});
  fireEvent.press(r.getByText("Leave lobby"));
  await waitFor(() => expect(mockRouter.back).toHaveBeenCalled());
});
it.each(["withClient", "retrospectiveCompletedAt"])(
  "preserves incompatible %s drafts after admission",
  async (field) => {
    mockState = { phase: "joined", members: [{ userId: "u" }], pending: [] };
    mockActive = {
      id: "own",
      userId: "u",
      status: "in_progress",
      exercises: [],
      [field]: true,
    };
    const r = renderWithTheme(<TogetherJoinContainer />);
    fireEvent.press(r.getByText("Use shared workout"));
    await waitFor(() => expect(r.getByText(/Could not connect/)).toBeTruthy());
    expect(mockLobby.workout.promote).not.toHaveBeenCalled();
  },
);
it("creates and caches only its own cloud draft after admission and reports pending approval", async () => {
  mockParams = { connection: "online", invitation: "token" };
  const r = renderWithTheme(<TogetherJoinContainer />);
  await act(async () => {});
  const own = {
    id: "cloud-own",
    userId: "u",
    status: "in_progress",
    exercises: [],
  };
  mockCloudDraft.mockReturnValue(own);
  fireEvent.press(r.getByText("Join"));
  await waitFor(() =>
    expect(mockStorage.cacheActiveSession).toHaveBeenCalledWith("u", own),
  );
  mockCloudState = { ...mockCloudState, phase: "pending-approval" };
  r.rerender(<TogetherJoinContainer />);
  expect(r.getByText(/Waiting for the host/)).toBeTruthy();
  mockCloudState = {
    ...mockCloudState,
    phase: "active",
    snapshot: { sessionId: "live" },
  };
  r.rerender(<TogetherJoinContainer />);
  await act(async () => {});
  fireEvent.press(r.getByText("Open my workout"));
  expect(mockRouter.replace).toHaveBeenCalledWith("/(app)/session");
});
it("pastes an online token from a reachable manual entry without reinterpreting it as local", async () => {
  const r = renderWithTheme(<TogetherJoinContainer />);
  fireEvent.press(r.getByText("Online"));
  fireEvent.changeText(r.getByLabelText("Invitation link or code"), "token");
  fireEvent.press(r.getByText("Join"));
  await waitFor(() =>
    expect(mockCloud.join).toHaveBeenCalledWith(
      { inviteToken: "token" },
      undefined,
    ),
  );
  fireEvent.press(r.getByText("Local"));
  expect(r.UNSAFE_getByType(TogetherLobbyPresenter)).toBeTruthy();
});
it("contains an unavailable adapter and does not invoke stale synchronous callbacks", async () => {
  mockHasLobby = false;
  mockHasCloud = false;
  const r = renderWithTheme(<TogetherJoinContainer />);
  act(() => lobbyProps(r).onCodeChange("signed"));
  await act(async () => lobbyProps(r).onSelect());
  expect(lobbyProps(r).notice).toContain("Could not connect");
  r.unmount();
  expect(mockLobby.selectInvite).not.toHaveBeenCalled();
});
it("leaves an admitted lobby deliberately and contains missing-plan and changed-workout failures", async () => {
  mockState = { phase: "joined", members: [{ userId: "u" }], pending: [] };
  const r = renderWithTheme(<TogetherJoinContainer />);
  await act(async () => fireEvent.press(r.getByText("Leave lobby")));
  expect(mockLobby.cancel).toHaveBeenCalled();
  expect(mockRouter.back).toHaveBeenCalled();
  mockStart.mockReturnValue({ ok: false });
  await act(async () => fireEvent.press(r.getByText("Use shared workout")));
  expect(r.getByText(/Could not connect/)).toBeTruthy();
  expect(mockLobby.workout.promote).not.toHaveBeenCalled();
});
it("ignores a queued Join when the screen disappears before execution", async () => {
  const r = renderWithTheme(<TogetherJoinContainer />);
  act(() => {
    lobbyProps(r).onJoin();
    r.unmount();
  });
  await act(async () => {});
  expect(mockLobby.join).not.toHaveBeenCalled();
});
