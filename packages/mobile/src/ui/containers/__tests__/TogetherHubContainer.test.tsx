import React from "react";
import { act, fireEvent, waitFor } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import {
  TogetherHubContainer,
  loadPartnerSessions,
  loadPartners,
  partnersSince,
} from "../TogetherHubContainer";
let mockHasLobby = true;
let mockUser = "u",
  mockAllowed = true,
  mockActive: any = null,
  mockSnapshot: any,
  mockRemote: any = null,
  mockHasSocial = true;
const mockPush = jest.fn(),
  mockBrowse = jest.fn(),
  mockFriends = jest.fn(),
  mockSocialFriends = jest.fn();
const mockLobby = {
  getSnapshot: () => mockSnapshot,
  subscribe: () => () => {},
  browse: () => mockBrowse(),
  cancel: jest.fn(),
  selectDiscovered: jest.fn(),
};
const mockCloud = {
  getSnapshot: () => ({ snapshot: mockRemote }),
  friends: (cursor?: string) => mockFriends(cursor),
};
const mockSocial = { friends: (cursor?: string) => mockSocialFriends(cursor) };
jest.mock("@/ui/hooks/useAdapters", () => ({
  useAdapters: () => ({
    api: { togetherSocial: mockHasSocial ? mockSocial : undefined },
    storage: { getActiveSession: () => mockActive },
    togetherLobby: mockHasLobby ? mockLobby : undefined,
    togetherCloud: mockCloud,
  }),
}));
jest.mock("@/ui/hooks/useAuth", () => ({
  useAuth: () => ({ session: { userId: mockUser } }),
}));
jest.mock("@/ui/hooks/useTogetherGate", () => ({
  useTogetherGate: () => ({
    allowed: mockAllowed,
    state: mockAllowed ? "allowed" : "locked",
    onUpgrade: jest.fn(),
    retry: jest.fn(),
  }),
}));
jest.mock("expo-router", () => ({
  router: { push: (...a: any[]) => mockPush(...a) },
  useFocusEffect: (cb: any) => jest.requireActual("react").useEffect(cb, [cb]),
}));
const page = (data: any[], nextCursor: string | null = null) => ({
  ok: true,
  value: { data, nextCursor },
});
const live = (sessionId: string, userId: string, occupancy = 2) => ({
  sessionId,
  host: { userId, displayName: null, avatarUrl: null },
  occupancy,
  expiresAt: "2026-10-23T12:00:00Z",
});
const partner = (
  userId: string,
  displayName: string | null,
  status = "accepted",
) => ({
  id: `r-${userId}`,
  userId: "u",
  friendId: userId,
  initiatedBy: userId,
  status,
  createdAt: "2026-07-01T10:00:00Z",
  updatedAt: "2026-07-03T10:00:00Z",
  person: { userId, displayName, avatarUrl: null },
});
beforeEach(() => {
  jest.clearAllMocks();
  mockHasLobby = true;
  mockHasSocial = true;
  mockUser = "u";
  mockAllowed = true;
  mockActive = null;
  mockRemote = null;
  mockSnapshot = { phase: "idle", members: [], pending: [] };
  mockFriends.mockResolvedValue(page([live("s1", "tom")]));
  mockSocialFriends.mockResolvedValue(
    page([
      partner("tom", "Tom Vance"),
      partner("mia", "Mia Osei"),
      partner("x", "Pending", "pending"),
    ]),
  );
});
it("composes Start and Join without any discovery, and shows partners with their Online sessions", async () => {
  const r = renderWithTheme(<TogetherHubContainer />);
  expect(mockBrowse).not.toHaveBeenCalled();
  fireEvent.press(r.getByLabelText("Join a session"));
  expect(mockPush).toHaveBeenLastCalledWith("/(app)/together/join");
  fireEvent.press(r.getByLabelText("Start a session"));
  expect(mockPush).toHaveBeenLastCalledWith("/(app)/together/start");
  await waitFor(() =>
    expect(r.getByText("Training now · 2 of 4 · Online")).toBeTruthy(),
  );
  expect(r.getByText("Training partners · 2")).toBeTruthy();
  expect(r.queryByText("Pending")).toBeNull();
  expect(mockBrowse).not.toHaveBeenCalled();
  fireEvent.press(r.getByLabelText("Join Tom Vance"));
  expect(mockPush).toHaveBeenLastCalledWith({
    pathname: "/(app)/together/join",
    params: { session: "s1", connection: "online" },
  });
  fireEvent.press(r.getByLabelText("View Mia Osei"));
  expect(mockPush).toHaveBeenLastCalledWith("/(app)/together/partners");
  mockFriends.mockResolvedValue(page([live("s2", "mia", 4)]));
  await act(async () =>
    r
      .getByTestId("together-hub-content")
      .props.refreshControl.props.onRefresh(),
  );
  await waitFor(() =>
    expect(r.getByText("Training now · 4 of 4 · Online")).toBeTruthy(),
  );
  expect(mockSocialFriends).toHaveBeenCalledTimes(2);
});
it.each(["workout", "cloud", "lobby", "locked"])(
  "offers no Online join and never searches while %s authority exists or access is denied",
  async (reason) => {
    if (reason === "workout") mockActive = { together: { transport: "lan" } };
    if (reason === "cloud") mockRemote = { sessionId: "live" };
    if (reason === "lobby") mockSnapshot = { ...mockSnapshot, phase: "joined" };
    if (reason === "locked") mockAllowed = false;
    const r = renderWithTheme(<TogetherHubContainer />);
    await act(async () => {});
    expect(mockBrowse).not.toHaveBeenCalled();
    expect(r.queryByLabelText("Join Tom Vance")).toBeNull();
    if (reason !== "locked") {
      fireEvent.press(r.getByText("Back to my workout"));
      expect(mockPush).toHaveBeenCalledWith("/(app)/session");
    } else expect(mockSocialFriends).not.toHaveBeenCalled();
  },
);
it("reports a failed partner load, tolerates a failed session load, and ignores a late reply after the account changed", async () => {
  mockFriends.mockRejectedValue(new Error("offline"));
  const r = renderWithTheme(<TogetherHubContainer />);
  await waitFor(() => expect(r.getByText("Tom Vance")).toBeTruthy());
  expect(r.queryByText(/Training now/)).toBeNull();
  let resolve!: (v: any) => void;
  mockSocialFriends.mockReturnValueOnce(new Promise((res) => (resolve = res)));
  await act(async () =>
    r
      .getByTestId("together-hub-content")
      .props.refreshControl.props.onRefresh(),
  );
  mockUser = "other";
  mockSocialFriends.mockRejectedValue(new Error("offline"));
  r.rerender(<TogetherHubContainer />);
  await act(async () => resolve(page([partner("zed", "Zed")])));
  expect(r.queryByText("Zed")).toBeNull();
  await waitFor(() =>
    expect(r.getByText(/Could not refresh training partners/)).toBeTruthy(),
  );
});
it("keeps the hub usable without native discovery or the social api", async () => {
  mockHasLobby = false;
  mockHasSocial = false;
  const r = renderWithTheme(<TogetherHubContainer />);
  await act(async () => {});
  expect(r.getByLabelText("Start a session")).toBeTruthy();
  expect(r.getByText("Training partners · 0")).toBeTruthy();
});
it("walks every page of partners and sessions, refuses looping cursors, and names the month", async () => {
  mockFriends
    .mockResolvedValueOnce(page([live("s1", "tom")], "next"))
    .mockResolvedValueOnce(page([live("s2", "mia")]));
  await expect(loadPartnerSessions(mockCloud as any)).resolves.toEqual([
    { sessionId: "s1", hostUserId: "tom", occupancy: 2 },
    { sessionId: "s2", hostUserId: "mia", occupancy: 2 },
  ]);
  expect(mockFriends).toHaveBeenLastCalledWith("next");
  mockFriends.mockResolvedValue(page([live("s1", "tom")], "loop"));
  await expect(loadPartnerSessions(mockCloud as any)).resolves.toHaveLength(10);
  mockFriends.mockResolvedValue({ ok: false, error: { code: "network" } });
  await expect(loadPartnerSessions(mockCloud as any)).rejects.toEqual({
    code: "network",
  });
  mockSocialFriends
    .mockResolvedValueOnce(page([partner("tom", "Tom Vance")], "n"))
    .mockResolvedValueOnce(
      page([{ ...partner("u2", null), userId: "u2", friendId: "u" }]),
    );
  await expect(loadPartners(mockSocial as any, "u")).resolves.toEqual([
    { userId: "tom", name: "Tom Vance", since: expect.any(String) },
    { userId: "u2", name: "Training partner", since: expect.any(String) },
  ]);
  mockSocialFriends.mockResolvedValue({
    ok: false,
    error: { code: "network" },
  });
  await expect(loadPartners(mockSocial as any, "u")).rejects.toEqual({
    code: "network",
  });
  expect(partnersSince("2026-07-03T10:00:00Z", new Date("2026-10-23"))).toBe(
    "July",
  );
  expect(partnersSince("2025-07-03T10:00:00Z", new Date("2026-10-23"))).toBe(
    "July 2025",
  );
  expect(partnersSince("nope")).toBeUndefined();
  expect(partnersSince(undefined)).toBeUndefined();
});
