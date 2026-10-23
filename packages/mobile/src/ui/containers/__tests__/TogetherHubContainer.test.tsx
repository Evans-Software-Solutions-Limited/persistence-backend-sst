import React from "react";
import { act, fireEvent, waitFor } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import {
  TogetherHubContainer,
  loadPartnerSessions,
} from "../TogetherHubContainer";
let mockHasLobby = true;
let mockUser = "u",
  mockAllowed = true,
  mockActive: any = null,
  mockSnapshot: any,
  mockRemote: any = null;
const mockPush = jest.fn(),
  mockBrowse = jest.fn(),
  mockCancel = jest.fn(),
  mockFriends = jest.fn();
const mockLobby = {
  getSnapshot: () => mockSnapshot,
  subscribe: () => () => {},
  browse: () => mockBrowse(),
  cancel: () => mockCancel(),
  selectDiscovered: jest.fn(),
};
const mockCloud = {
  getSnapshot: () => ({ snapshot: mockRemote }),
  friends: (cursor?: string) => mockFriends(cursor),
};
jest.mock("@/ui/hooks/useAdapters", () => ({
  useAdapters: () => ({
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
const mockPartners = jest.fn();
jest.mock("../TogetherPartnersContainer", () => ({
  TogetherPartnersContainer: (props: any) => {
    mockPartners(props);
    const { View, Pressable, Text } = jest.requireActual("react-native");
    return (
      <View testID="partners-inline">
        {props.header}
        {props.onlineSessions?.map((s: any) => (
          <Pressable
            key={s.sessionId}
            accessibilityLabel={`Join ${s.hostUserId}`}
            onPress={() => props.onJoinOnline?.(s.sessionId)}
          >
            <Text>{`${s.hostUserId} ${s.occupancy}`}</Text>
          </Pressable>
        ))}
        <Pressable accessibilityLabel="refresh" onPress={props.onRefresh}>
          <Text>refresh</Text>
        </Pressable>
      </View>
    );
  },
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
beforeEach(() => {
  jest.clearAllMocks();
  mockHasLobby = true;
  mockUser = "u";
  mockAllowed = true;
  mockActive = null;
  mockRemote = null;
  mockSnapshot = { phase: "idle", members: [], pending: [] };
  mockFriends.mockResolvedValue(page([live("s1", "tom")]));
});
it("composes Start and Join without any discovery, and loads partners' Online sessions on focus", async () => {
  const r = renderWithTheme(<TogetherHubContainer />);
  expect(mockBrowse).not.toHaveBeenCalled();
  expect(mockPartners.mock.calls.at(-1)![0].embedded).toBe(true);
  fireEvent.press(r.getByLabelText("Join a session"));
  expect(mockPush).toHaveBeenLastCalledWith("/(app)/together/join");
  fireEvent.press(r.getByLabelText("Start a session"));
  expect(mockPush).toHaveBeenLastCalledWith("/(app)/together/start");
  await waitFor(() => expect(r.getByText("tom 2")).toBeTruthy());
  expect(mockBrowse).not.toHaveBeenCalled();
  fireEvent.press(r.getByLabelText("Join tom"));
  expect(mockPush).toHaveBeenLastCalledWith({
    pathname: "/(app)/together/join",
    params: { session: "s1", connection: "online" },
  });
  mockFriends.mockResolvedValue(page([live("s2", "mia", 4)]));
  fireEvent.press(r.getByLabelText("refresh"));
  await waitFor(() => expect(r.getByText("mia 4")).toBeTruthy());
  expect(mockFriends).toHaveBeenCalledTimes(2);
});
it.each(["workout", "cloud", "lobby", "locked"])(
  "hides partner sessions and never searches while %s authority exists or access is denied",
  async (reason) => {
    if (reason === "workout") mockActive = { together: { transport: "lan" } };
    if (reason === "cloud") mockRemote = { sessionId: "live" };
    if (reason === "lobby") mockSnapshot = { ...mockSnapshot, phase: "joined" };
    if (reason === "locked") mockAllowed = false;
    const r = renderWithTheme(<TogetherHubContainer />);
    await act(async () => {});
    expect(mockBrowse).not.toHaveBeenCalled();
    expect(r.queryByText("tom 2")).toBeNull();
    if (reason !== "locked") {
      fireEvent.press(r.getByText("Back to my workout"));
      expect(mockPush).toHaveBeenCalledWith("/(app)/session");
    } else expect(mockFriends).not.toHaveBeenCalled();
  },
);
it("ignores a late partner-session reply after the account changed and tolerates a failed load", async () => {
  let resolve!: (v: any) => void;
  mockFriends.mockReturnValueOnce(new Promise((r) => (resolve = r)));
  const r = renderWithTheme(<TogetherHubContainer />);
  mockUser = "other";
  mockFriends.mockRejectedValue(new Error("offline"));
  r.rerender(<TogetherHubContainer />);
  await act(async () => resolve(page([live("s1", "tom")])));
  expect(r.queryByText("tom 2")).toBeNull();
  expect(r.getByLabelText("Join a session")).toBeTruthy();
});
it("keeps the hub usable without native discovery", async () => {
  mockHasLobby = false;
  const r = renderWithTheme(<TogetherHubContainer />);
  await waitFor(() => expect(r.getByText("tom 2")).toBeTruthy());
  expect(r.getByLabelText("Start a session")).toBeTruthy();
});
it("walks every page of partners' sessions and refuses a looping cursor", async () => {
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
});
