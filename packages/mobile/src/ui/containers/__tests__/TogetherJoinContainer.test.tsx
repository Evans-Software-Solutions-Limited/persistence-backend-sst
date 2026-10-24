import React from "react";
import { AppState, Linking } from "react-native";
import { act, fireEvent, waitFor } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import {
  TogetherJoinContainer,
  togetherSearchFailure,
} from "../TogetherJoinContainer";
import { usePendingTogetherJoin } from "@/state/pending-together-join";
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
  getCachedExercises: () => [
    { id: "33333333-3333-4333-8333-333333333333", name: "Squat" },
  ],
};
const listeners = new Set<() => void>();
const publish = (change: any) =>
  act(() => {
    mockState = { ...mockState, ...change };
    listeners.forEach((l) => l());
  });
const cloudListeners = new Set<() => void>();
const publishCloud = (change: any) =>
  act(() => {
    mockCloudState = { ...mockCloudState, ...change };
    cloudListeners.forEach((l) => l());
  });
const plan = {
  name: "Push",
  exercises: [
    {
      planExerciseId: "22222222-2222-4222-8222-222222222222",
      exerciseId: "33333333-3333-4333-8333-333333333333",
      order: 0,
      targetSets: 1,
    },
  ],
};
const mockLobby: any = {
  getSnapshot: () => mockState,
  subscribe: (l: () => void) => {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  cancel: jest.fn(async () => {}),
  selectTransport: jest.fn(),
  selectInvite: jest.fn(async () => {}),
  selectCode: jest.fn(async () => {}),
  join: jest.fn(async () => {}),
  browse: jest.fn(async () => {}),
  selectDiscovered: jest.fn(async () => {}),
  workout: { promote: jest.fn(async () => {}) },
  shared: { getSnapshot: () => ({ plan }) },
};
const mockFriends = jest.fn();
const mockSocialFriends = jest.fn();
const mockCloud: any = {
  getSnapshot: () => mockCloudState,
  subscribe: (l: () => void) => {
    cloudListeners.add(l);
    return () => cloudListeners.delete(l);
  },
  join: jest.fn(async () => {}),
  cancelJoin: jest.fn(async () => {}),
  cancel: jest.fn(),
  readDraft: jest.fn(() => ({ id: "own-draft", userId: "u" })),
  friends: (cursor?: string) => mockFriends(cursor),
  preview: jest.fn(),
};
const preview = {
  sessionId: "s-kai",
  audience: "friends",
  host: { userId: "kai", displayName: "Kai Anand", avatarUrl: null },
  occupancy: 2,
  partner: false,
  expiresAt: "x",
  workoutName: "Push A",
  startedAt: new Date(Date.now() - 18 * 60_000).toISOString(),
  plan: [{ name: "Bench Press", sets: 4, reps: 8 }],
};
jest.mock("@/ui/hooks/useAdapters", () => ({
  useAdapters: () => ({
    storage: mockStorage,
    api: { togetherSocial: { friends: (c?: string) => mockSocialFriends(c) } },
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
  useFocusEffect: (cb: any) => jest.requireActual("react").useEffect(cb, [cb]),
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
const page = (data: any[]) => ({ ok: true, value: { data, nextCursor: null } });
const partner = (userId: string, displayName: string) => ({
  id: `r-${userId}`,
  userId: "u",
  friendId: userId,
  initiatedBy: userId,
  status: "accepted",
  createdAt: "2026-07-01",
  updatedAt: "2026-07-01",
  person: { userId, displayName, avatarUrl: null },
});
const discovered = (
  sessionId: string,
  hostUserId: string,
  memberCount = 1,
) => ({
  sessionId,
  hostUserId,
  workoutName: "Lower Body B",
  memberCount,
});
beforeEach(() => {
  jest.clearAllMocks();
  usePendingTogetherJoin.getState().reset();
  mockHasLobby = true;
  mockHasCloud = true;
  jest
    .spyOn(AppState, "addEventListener")
    .mockImplementation(() => ({ remove: jest.fn() }));
  jest.spyOn(Linking, "openSettings").mockResolvedValue(undefined);
  mockUser = "u";
  mockParams = {};
  mockActive = null;
  mockAllowed = true;
  mockId = 0;
  mockState = { phase: "idle", members: [], pending: [] };
  mockCloudState = {
    phase: "idle",
    requests: [],
    previous: {},
    pendingCount: 0,
  };
  mockLobby.browse.mockImplementation(async () => {
    publish({ phase: "browsing", searching: true, discovered: [] });
  });
  mockLobby.selectDiscovered.mockImplementation(async (id: string) => {
    const row = (mockState.discovered ?? []).find(
      (d: any) => d.sessionId === id,
    );
    publish({
      phase: "selected",
      selection: { hostUserId: row.hostUserId, workoutName: row.workoutName },
    });
  });
  mockLobby.selectInvite.mockImplementation(async () => {
    publish({
      phase: "selected",
      selection: { hostUserId: "brad", workoutName: "Lower Body B" },
    });
  });
  mockLobby.cancel.mockImplementation(async () => {
    publish({
      phase: "idle",
      discovered: undefined,
      selection: undefined,
      searching: undefined,
    });
  });
  mockSocialFriends.mockResolvedValue(
    page([partner("brad", "Brad Evans"), partner("tom", "Tom Vance")]),
  );
  mockFriends.mockResolvedValue(page([]));
  mockStart.mockReturnValue({
    ok: true,
    value: {
      id: "new-own",
      userId: "u",
      status: "in_progress",
      startedAt: "2026-10-23T09:00:00Z",
      exercises: [],
    },
  });
});

it("searches as soon as it opens, lists verified partners, non-partners and full sessions, and stops at 30 s keeping the results", async () => {
  const r = renderWithTheme(<TogetherJoinContainer />);
  await waitFor(() => expect(mockLobby.browse).toHaveBeenCalledTimes(1));
  expect(r.getByText(/Searching nearby/)).toBeTruthy();
  publish({
    discovered: [
      discovered("s-brad", "brad", 3),
      discovered("s-kai", "kai"),
      discovered("s-lena", "lena", 4),
    ],
  });
  await waitFor(() => expect(r.getByText("Brad Evans")).toBeTruthy());
  expect(r.getByText("Lower Body B · 3 of 4")).toBeTruthy();
  expect(r.getByText("Verified partner · Nearby")).toBeTruthy();
  expect(r.getByLabelText("Ask to join Lower Body B")).toBeTruthy();
  expect(r.getByText("Full · 4 of 4")).toBeTruthy();
  // The controller stops the radio; the list stays, with pull-to-refresh offered.
  publish({ searching: false });
  expect(r.getByText("Pull down to refresh")).toBeTruthy();
  expect(r.queryByText(/Searching nearby/)).toBeNull();
  // Pull-to-refresh searches again.
  await act(async () =>
    r
      .getByTestId("together-join-scroll")
      .props.refreshControl.props.onRefresh(),
  );
  expect(mockLobby.browse).toHaveBeenCalledTimes(2);
  // Leaving the screen cancels a search; a selection is kept.
  r.unmount();
  expect(mockLobby.cancel).toHaveBeenCalled();
});
it("says nothing found after a search with no results and can't search when the radio is off", async () => {
  const r = renderWithTheme(<TogetherJoinContainer />);
  await waitFor(() => expect(mockLobby.browse).toHaveBeenCalled());
  publish({ searching: false });
  expect(r.getByText("No sessions nearby")).toBeTruthy();
  fireEvent.press(r.getByText("Search again"));
  expect(mockLobby.browse).toHaveBeenCalledTimes(2);
  publish({
    phase: "unavailable",
    error: "nearby_unavailable",
    searching: undefined,
  });
  expect(r.getByText("Can’t search nearby")).toBeTruthy();
  expect(r.getByText(/Wi-Fi is off/)).toBeTruthy();
  fireEvent.press(r.getByText("Open Settings"));
  expect(Linking.openSettings).toHaveBeenCalledTimes(1);
  expect(togetherSearchFailure("expired")).toMatch(
    /offline access has expired/,
  );
  expect(togetherSearchFailure("discovery_failed")).toMatch(/Wi-Fi is off/);
});
it("joins a verified partner's nearby session: consent → connecting → admitted → plan adopted → workout", async () => {
  const r = renderWithTheme(<TogetherJoinContainer />);
  await waitFor(() => expect(mockLobby.browse).toHaveBeenCalled());
  publish({ discovered: [discovered("s-brad", "brad", 3)] });
  await waitFor(() => expect(r.getByText("Brad Evans")).toBeTruthy());
  fireEvent.press(r.getByLabelText("Join Brad Evans"));
  await waitFor(() => expect(r.getByText("Join this workout")).toBeTruthy());
  expect(mockLobby.selectDiscovered).toHaveBeenCalledWith("s-brad");
  expect(r.getByText("Brad’s session")).toBeTruthy();
  expect(r.getByText("3 of 4")).toBeTruthy();
  expect(mockLobby.join).not.toHaveBeenCalled();
  fireEvent.press(r.getByText("Join and start"));
  await waitFor(() => expect(mockLobby.join).toHaveBeenCalledTimes(1));
  publish({ phase: "searching" });
  expect(r.getByText("Connecting to Brad’s phone")).toBeTruthy();
  publish({ phase: "joined" });
  await waitFor(() =>
    expect(mockRouter.replace).toHaveBeenCalledWith("/(app)/session"),
  );
  expect(mockStart).toHaveBeenCalled();
  expect(mockLobby.workout.promote).toHaveBeenCalledWith(
    expect.objectContaining({
      name: "Push",
      exercises: [expect.objectContaining({ exerciseName: "Squat" })],
    }),
  );
  expect(mockStorage.cacheActiveSession).toHaveBeenCalled();
  expect(mockReread).toHaveBeenCalled();
});
it("a non-partner asks to join and waits for the host; cancel returns to the list", async () => {
  const r = renderWithTheme(<TogetherJoinContainer />);
  await waitFor(() => expect(mockLobby.browse).toHaveBeenCalled());
  publish({ discovered: [discovered("s-kai", "kai")] });
  await waitFor(() =>
    expect(r.getByLabelText("Ask to join Lower Body B")).toBeTruthy(),
  );
  fireEvent.press(r.getByLabelText("Ask to join Lower Body B"));
  await waitFor(() =>
    expect(r.getByText("Ask the host and start")).toBeTruthy(),
  );
  fireEvent.press(r.getByText("Ask the host and start"));
  await waitFor(() => expect(mockLobby.join).toHaveBeenCalled());
  publish({ phase: "pending-approval" });
  expect(r.getByText("Waiting for the host to let you in")).toBeTruthy();
  fireEvent.press(r.getByText("Cancel"));
  await waitFor(() => expect(mockLobby.cancel).toHaveBeenCalled());
  await waitFor(() => expect(r.getByText("Join a session")).toBeTruthy());
  expect(mockLobby.browse).toHaveBeenCalledTimes(2);
});
it("a refused or full join comes back to the list with the reason", async () => {
  const r = renderWithTheme(<TogetherJoinContainer />);
  await waitFor(() => expect(mockLobby.browse).toHaveBeenCalled());
  publish({ discovered: [discovered("s-brad", "brad")] });
  await waitFor(() => expect(r.getByText("Brad Evans")).toBeTruthy());
  fireEvent.press(r.getByLabelText("Join Brad Evans"));
  await waitFor(() => expect(r.getByText("Join and start")).toBeTruthy());
  fireEvent.press(r.getByText("Join and start"));
  await waitFor(() => expect(mockLobby.join).toHaveBeenCalled());
  publish({ phase: "full", error: "full" });
  await waitFor(() => expect(r.getByText("Join a session")).toBeTruthy());
  expect(r.getByText(/This lobby is full|Could not connect/)).toBeTruthy();
});
it("a cold-start link lands on Join this workout, clears the stash, and never joins by itself", async () => {
  usePendingTogetherJoin
    .getState()
    .setPending({ connection: "local", invitation: "signed" });
  mockParams = {
    connection: "local",
    invitation: "signed",
    transport: "nearby",
  };
  const r = renderWithTheme(<TogetherJoinContainer />);
  await waitFor(() => expect(r.getByText("Join this workout")).toBeTruthy());
  expect(usePendingTogetherJoin.getState().pending).toBeNull();
  expect(mockLobby.selectTransport).toHaveBeenCalledWith("nearby");
  expect(mockLobby.selectInvite).toHaveBeenCalledWith("signed");
  expect(mockLobby.browse).not.toHaveBeenCalled();
  expect(mockLobby.join).not.toHaveBeenCalled();
  await waitFor(() =>
    expect(r.getByText(/Opened from Brad’s QR/)).toBeTruthy(),
  );
  fireEvent.press(r.getByLabelText("Back"));
  await waitFor(() => expect(mockLobby.cancel).toHaveBeenCalled());
  expect(mockLobby.browse).not.toHaveBeenCalled();
});
it("a pasted online link and a scanned QR select without a mode choice; camera denial keeps paste", async () => {
  const r = renderWithTheme(<TogetherJoinContainer />);
  await waitFor(() => expect(mockLobby.browse).toHaveBeenCalled());
  expect(r.queryByText("Nearby")).toBeNull();
  expect(r.queryByText("Online")).toBeNull();
  mockRequest.mockResolvedValueOnce({ granted: false });
  fireEvent.press(r.getByText("Scan a QR code"));
  await waitFor(() =>
    expect(r.getByText(/Camera permission is needed/)).toBeTruthy(),
  );
  fireEvent.changeText(
    r.getByLabelText("Session code"),
    "persistencemobile://together/join?connection=online&invitation=tok",
  );
  fireEvent.press(r.getByText("Continue"));
  await waitFor(() => expect(r.getByText("Join this workout")).toBeTruthy());
  expect(r.getByText("Online · internet required")).toBeTruthy();
  expect(mockLobby.selectInvite).not.toHaveBeenCalled();
  fireEvent.press(r.getByText("Ask the host and start"));
  await waitFor(() =>
    expect(mockCloud.join).toHaveBeenCalledWith(
      { inviteToken: "tok" },
      undefined,
    ),
  );
  publishCloud({ phase: "pending-approval" });
  expect(r.getByText("Waiting for the host to let you in")).toBeTruthy();
  publishCloud({ phase: "active", snapshot: { sessionId: "c" } });
  await waitFor(() =>
    expect(mockRouter.replace).toHaveBeenCalledWith("/(app)/session"),
  );
  expect(mockStorage.cacheActiveSession).toHaveBeenCalledWith("u", {
    id: "own-draft",
    userId: "u",
  });
});
it("cancelling a pending Online join withdraws the request even while the nearby search runs (inspector lead)", async () => {
  const r = renderWithTheme(<TogetherJoinContainer />);
  await waitFor(() => expect(mockLobby.browse).toHaveBeenCalled());
  // The join screen's own search leaves the lobby browsing behind the Online target.
  publish({ phase: "browsing", discovered: [] });
  fireEvent.changeText(
    r.getByLabelText("Session code"),
    "persistencemobile://together/join?connection=online&invitation=tok",
  );
  fireEvent.press(r.getByText("Continue"));
  await waitFor(() => expect(r.getByText("Join this workout")).toBeTruthy());
  fireEvent.press(r.getByText("Ask the host and start"));
  await waitFor(() => expect(mockCloud.join).toHaveBeenCalled());
  publishCloud({ phase: "pending-approval" });
  expect(r.getByText("Waiting for the host to let you in")).toBeTruthy();
  fireEvent.press(r.getByText("Cancel"));
  await waitFor(() => expect(mockCloud.cancelJoin).toHaveBeenCalledTimes(1));
  expect(mockLobby.cancel).not.toHaveBeenCalled();
  expect(mockCloud.cancel).not.toHaveBeenCalled();
  await waitFor(() => expect(r.getByText("Join a session")).toBeTruthy());
});
it("scans a QR once and selects it; a malformed scan reports without creating a workout", async () => {
  mockRequest.mockResolvedValue({ granted: true });
  const r = renderWithTheme(<TogetherJoinContainer />);
  await waitFor(() => expect(mockLobby.browse).toHaveBeenCalled());
  fireEvent.press(r.getByText("Scan a QR code"));
  const camera = await r.findByTestId("together-join-camera");
  act(() => {
    camera.props.onBarcodeScanned({ data: "not a link ://" });
    camera.props.onBarcodeScanned({ data: "duplicate" });
  });
  await waitFor(() => expect(r.getByText(/Could not connect/)).toBeTruthy());
  expect(mockStart).not.toHaveBeenCalled();
  expect(mockLobby.selectInvite).not.toHaveBeenCalled();
});
it("joins a partner's Online session from the hub and from the list", async () => {
  mockFriends.mockResolvedValue(
    page([
      {
        sessionId: "s-tom",
        host: { userId: "tom", displayName: "Tom Vance", avatarUrl: null },
        occupancy: 2,
        expiresAt: "x",
        workoutName: "Push A",
        startedAt: "2026-10-23T11:30:00Z",
        plan: [{ name: "Bench Press", sets: 4, reps: 8 }],
      },
    ]),
  );
  mockParams = { session: "s-tom", connection: "online" };
  const r = renderWithTheme(<TogetherJoinContainer />);
  await waitFor(() => expect(r.getByText("Join this workout")).toBeTruthy());
  expect(r.getByText("Tom’s session")).toBeTruthy();
  expect(r.getByText(/^2 of 4 · started/)).toBeTruthy();
  expect(r.getByText("Push A")).toBeTruthy();
  expect(r.getByText("4 × 8")).toBeTruthy();
  fireEvent.press(r.getByText("Join and start"));
  await waitFor(() =>
    expect(mockCloud.join).toHaveBeenCalledWith(
      { sessionId: "s-tom" },
      undefined,
    ),
  );
  fireEvent.press(r.getByText("Cancel"));
  await waitFor(() => expect(mockCloud.cancel).toHaveBeenCalled());
  await waitFor(() => expect(r.getByText("Join a session")).toBeTruthy());
  await waitFor(() =>
    expect(r.getByText("Online · internet required")).toBeTruthy(),
  );
  fireEvent.press(r.getByLabelText("Join Tom Vance"));
  await waitFor(() => expect(r.getByText("Join this workout")).toBeTruthy());
});
it("an unknown hub session reports instead of joining", async () => {
  mockParams = { session: "gone", connection: "online" };
  const r = renderWithTheme(<TogetherJoinContainer />);
  await waitFor(() =>
    expect(r.getByText(/no longer available to join/)).toBeTruthy(),
  );
  expect(mockCloud.join).not.toHaveBeenCalled();
});
it("preserves an existing live workout and gates unpaid access", async () => {
  mockActive = { together: { sessionId: "s" } };
  const r = renderWithTheme(<TogetherJoinContainer />);
  expect(r.getByText(/You already have a live session/)).toBeTruthy();
  expect(mockLobby.browse).not.toHaveBeenCalled();
  fireEvent.press(r.getByText("Back to my workout"));
  expect(mockRouter.replace).toHaveBeenCalledWith("/(app)/session");
  mockActive = null;
  mockAllowed = false;
  r.rerender(<TogetherJoinContainer />);
  expect(r.getByText(/qualifying paid subscription/)).toBeTruthy();
  fireEvent.press(r.getByText("Back"));
  expect(mockRouter.back).toHaveBeenCalled();
});
it("keeps logged sets and appends the plan when a solo workout is open", async () => {
  mockActive = {
    id: "own",
    userId: "u",
    name: "Mine",
    status: "in_progress",
    startedAt: "2026-10-23T09:00:00Z",
    exercises: [
      { id: "slot", exerciseId: "x", sortOrder: 0, sets: [{ id: "set" }] },
    ],
  };
  mockStorage.getActiveSession.mockReturnValue(mockActive);
  const r = renderWithTheme(<TogetherJoinContainer />);
  await waitFor(() => expect(mockLobby.browse).toHaveBeenCalled());
  publish({ discovered: [discovered("s-brad", "brad")] });
  await waitFor(() => expect(r.getByText("Brad Evans")).toBeTruthy());
  fireEvent.press(r.getByLabelText("Join Brad Evans"));
  await waitFor(() => expect(r.getByText("Join and start")).toBeTruthy());
  fireEvent.press(r.getByText("Join and start"));
  await waitFor(() => expect(mockLobby.join).toHaveBeenCalled());
  publish({ phase: "joined" });
  await waitFor(() => expect(mockLobby.workout.promote).toHaveBeenCalled());
  expect(mockStart).not.toHaveBeenCalled();
  const promoted = mockLobby.workout.promote.mock.calls[0][0];
  expect(promoted.name).toBe("Mine");
  expect(promoted.exercises).toHaveLength(2);
  expect(promoted.exercises[0].sets).toHaveLength(1);
});
it("works without native discovery: no search, code and Online rows only", async () => {
  mockHasLobby = false;
  const r = renderWithTheme(<TogetherJoinContainer />);
  await waitFor(() =>
    expect(r.getByText(/Nearby search is not available/)).toBeTruthy(),
  );
  expect(mockSocialFriends).toHaveBeenCalled();
});
it("ignores a late selection after the account changes", async () => {
  let resolve!: () => void;
  mockLobby.selectDiscovered.mockReturnValue(
    new Promise<void>((r) => (resolve = r)),
  );
  const r = renderWithTheme(<TogetherJoinContainer />);
  await waitFor(() => expect(mockLobby.browse).toHaveBeenCalled());
  publish({ discovered: [discovered("s-brad", "brad")] });
  await waitFor(() => expect(r.getByText("Brad Evans")).toBeTruthy());
  fireEvent.press(r.getByLabelText("Join Brad Evans"));
  mockUser = "other";
  r.rerender(<TogetherJoinContainer />);
  await act(async () => resolve());
  expect(r.queryByText("Join this workout")).toBeNull();
});

it("a typed code that a nearby host advertised selects it without the internet (PER-60)", async () => {
  mockLobby.selectCode.mockImplementation(async () => {
    publish({
      phase: "selected",
      selection: {
        hostUserId: "h",
        workoutName: "Push A",
        startedAt: Date.now() - 60_000,
        plan: [{ name: "Squat", sets: 3, reps: 5 }],
      },
    });
  });
  const r = renderWithTheme(<TogetherJoinContainer />);
  await waitFor(() => expect(mockLobby.browse).toHaveBeenCalled());
  publish({
    discovered: [
      {
        sessionId: "d1",
        hostUserId: "h",
        workoutName: "Push A",
        memberCount: 1,
        code: "4KQ928",
      },
    ],
  });
  fireEvent.changeText(r.getByLabelText("Session code"), "4kq-928");
  fireEvent.press(r.getByText("Continue"));
  await waitFor(() => expect(r.getByText("Join this workout")).toBeTruthy());
  expect(mockLobby.selectCode).toHaveBeenCalledWith("4KQ928");
  expect(mockCloud.preview).not.toHaveBeenCalled();
  expect(r.getByText("Push A")).toBeTruthy();
  expect(r.getByText("The plan")).toBeTruthy();
  expect(r.getByText("3 × 5")).toBeTruthy();
  expect(r.getByText(/started 1 minute ago/)).toBeTruthy();
});
it("a typed code nobody nearby answers to is previewed Online, then joins with the code (PER-60)", async () => {
  mockCloud.preview.mockResolvedValue({ ok: true, value: preview });
  const r = renderWithTheme(<TogetherJoinContainer />);
  await waitFor(() => expect(mockLobby.browse).toHaveBeenCalled());
  fireEvent.changeText(r.getByLabelText("Session code"), "4KQ-928");
  fireEvent.press(r.getByText("Continue"));
  await waitFor(() => expect(r.getByText("Join this workout")).toBeTruthy());
  expect(mockLobby.selectCode).not.toHaveBeenCalled();
  expect(mockCloud.preview).toHaveBeenCalledWith({ code: "4KQ928" });
  expect(r.getByText("Kai’s session")).toBeTruthy();
  expect(r.getByText("Push A")).toBeTruthy();
  expect(r.getByText("2 of 4 · started 18 minutes ago")).toBeTruthy();
  expect(r.getByText("4 × 8")).toBeTruthy();
  expect(r.getByText("Online · internet required")).toBeTruthy();
  fireEvent.press(r.getByText("Ask Kai and start"));
  await waitFor(() => expect(mockCloud.join).toHaveBeenCalled());
  expect(mockCloud.join.mock.calls[0][0]).toEqual({ code: "4KQ928" });
});
it("a code the backend cannot find, or cannot be checked offline, says so (PER-60)", async () => {
  mockCloud.preview.mockResolvedValueOnce({
    ok: false,
    error: { kind: "api", code: "not_found", message: "no" },
  });
  const r = renderWithTheme(<TogetherJoinContainer />);
  await waitFor(() => expect(mockLobby.browse).toHaveBeenCalled());
  fireEvent.changeText(r.getByLabelText("Session code"), "ZZZ-ZZZ");
  fireEvent.press(r.getByText("Continue"));
  await waitFor(() =>
    expect(r.getByText(/Couldn’t find that code/)).toBeTruthy(),
  );
  mockCloud.preview.mockResolvedValueOnce({
    ok: false,
    error: { kind: "api", code: "network", message: "offline" },
  });
  fireEvent.press(r.getByText("Continue"));
  await waitFor(() =>
    expect(r.getByText(/No internet to check that code/)).toBeTruthy(),
  );
  expect(r.queryByText("Join this workout")).toBeNull();
});
it("a pasted Online link fills the consent card in from the preview (PER-60)", async () => {
  mockCloud.preview.mockResolvedValue({
    ok: true,
    value: { ...preview, partner: true },
  });
  const r = renderWithTheme(<TogetherJoinContainer />);
  await waitFor(() => expect(mockLobby.browse).toHaveBeenCalled());
  fireEvent.changeText(
    r.getByLabelText("Session code"),
    "persistencemobile://together/join?connection=online&invitation=tok",
  );
  fireEvent.press(r.getByText("Continue"));
  await waitFor(() => expect(r.getByText("Kai’s session")).toBeTruthy());
  expect(mockCloud.preview).toHaveBeenCalledWith({ inviteToken: "tok" });
  expect(r.getByText("Push A")).toBeTruthy();
  expect(r.getByText("Bench Press")).toBeTruthy();
  // A partner joins straight in.
  fireEvent.press(r.getByText("Join and start"));
  await waitFor(() => expect(mockCloud.join).toHaveBeenCalled());
  expect(mockCloud.join.mock.calls[0][0]).toEqual({ inviteToken: "tok" });
});

it("a gated user arriving from a cold-start QR is not sent back to the join screen forever (inspector lead 4)", async () => {
  mockAllowed = false;
  usePendingTogetherJoin
    .getState()
    .setPending({ connection: "local", invitation: "signed" });
  mockParams = { connection: "local", invitation: "signed" };
  const r = renderWithTheme(<TogetherJoinContainer />);
  expect(r.getByText(/qualifying paid subscription/)).toBeTruthy();
  await waitFor(() =>
    expect(usePendingTogetherJoin.getState().pending).toBeNull(),
  );
  expect(mockLobby.selectInvite).not.toHaveBeenCalled();
});
it("a row that expired before it was picked says so and offers Search again, not Wi-Fi (inspector lead 5)", async () => {
  mockLobby.selectDiscovered.mockImplementationOnce(async () => {
    publish({
      phase: "unavailable",
      error: "discovery-expired",
      discovered: [],
    });
  });
  const r = renderWithTheme(<TogetherJoinContainer />);
  await waitFor(() => expect(mockLobby.browse).toHaveBeenCalled());
  publish({
    discovered: [
      {
        sessionId: "d1",
        hostUserId: "h",
        workoutName: "Push A",
        memberCount: 1,
      },
    ],
  });
  fireEvent.press(r.getByLabelText("Ask to join Push A"));
  await waitFor(() => expect(r.getByText(/no longer nearby/)).toBeTruthy());
  expect(r.queryByText(/Wi-Fi is off/)).toBeNull();
  expect(r.getByText("Search again")).toBeTruthy();
  expect(togetherSearchFailure("discovery-expired")).not.toMatch(/Wi-Fi/);
});
