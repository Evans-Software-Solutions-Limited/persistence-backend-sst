import React from "react";
import { act, waitFor, fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import { TogetherHubContainer } from "../TogetherHubContainer";
let mockHasLobby = true;
let mockUser = "u",
  mockAllowed = true,
  mockActive: any = null,
  mockSnapshot: any,
  mockRemote: any = null;
const mockPush = jest.fn(),
  mockBrowse = jest.fn(),
  mockCancel = jest.fn(),
  mockSelect = jest.fn();
const mockLobby = {
  getSnapshot: () => mockSnapshot,
  subscribe: () => () => {},
  browse: () => mockBrowse(),
  cancel: () => mockCancel(),
  selectDiscovered: (id: string) => mockSelect(id),
};
jest.mock("@/ui/hooks/useAdapters", () => ({
  useAdapters: () => ({
    storage: { getActiveSession: () => mockActive },
    togetherLobby: mockHasLobby ? mockLobby : undefined,
    togetherCloud: { getSnapshot: () => ({ snapshot: mockRemote }) },
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
  useFocusEffect: (cb: any) => require("react").useEffect(cb, [cb]),
}));
jest.mock("../TogetherPartnersContainer", () => ({
  TogetherPartnersContainer: ({ header, onRefresh, embedded }: any) => {
    const { View } = require("react-native");
    return (
      <View testID="partners-inline" onRefresh={onRefresh} embedded={embedded}>
        {header}
      </View>
    );
  },
}));
beforeEach(() => {
  jest.clearAllMocks();
  mockHasLobby = true;
  mockUser = "u";
  mockAllowed = true;
  mockActive = null;
  mockRemote = null;
  mockSnapshot = {
    phase: "idle",
    members: [],
    pending: [],
    discovered: [{ sessionId: "live", workoutName: "Push", memberCount: 2 }],
  };
  mockBrowse.mockImplementation(async () => {
    mockSnapshot = { ...mockSnapshot, phase: "browsing" };
  });
  mockCancel.mockResolvedValue(undefined);
  mockSelect.mockImplementation(async () => {
    mockSnapshot = { ...mockSnapshot, phase: "selected" };
  });
});
it("composes discovery and partners under one refresh and exposes join/scanner/start routes", async () => {
  const r = renderWithTheme(<TogetherHubContainer />);
  await waitFor(() => expect(mockBrowse).toHaveBeenCalledTimes(1));
  expect(r.getByTestId("partners-inline").props.embedded).toBe(true);
  fireEvent.press(r.getByText("Join a session"));
  expect(mockPush).toHaveBeenLastCalledWith("/(app)/together/join");
  fireEvent.press(r.getByText("Scan invitation"));
  expect(mockPush).toHaveBeenLastCalledWith({
    pathname: "/(app)/together/join",
    params: { scan: "true" },
  });
  fireEvent.press(r.getByText("Choose a workout"));
  expect(mockPush).toHaveBeenLastCalledWith("/(app)/together/start");
  await act(async () => r.getByTestId("partners-inline").props.onRefresh());
  expect(mockBrowse).toHaveBeenCalledTimes(2);
});
it("selects a verified discovery without automatic admission and preserves it on route blur", async () => {
  const r = renderWithTheme(<TogetherHubContainer />);
  await act(async () => {});
  fireEvent.press(r.getByText("View and join"));
  await waitFor(() =>
    expect(mockPush).toHaveBeenCalledWith("/(app)/together/join"),
  );
  expect(mockSelect).toHaveBeenCalledWith("live");
  r.unmount();
  expect(mockCancel).not.toHaveBeenCalled();
});
it.each(["workout", "cloud", "locked"])(
  "does not start discovery over %s authority",
  (reason) => {
    if (reason === "workout") mockActive = { together: { transport: "lan" } };
    if (reason === "cloud") mockRemote = { sessionId: "live" };
    if (reason === "locked") mockAllowed = false;
    const r = renderWithTheme(<TogetherHubContainer />);
    expect(mockBrowse).not.toHaveBeenCalled();
    expect(r.getByTestId("partners-inline")).toBeTruthy();
  },
);
it("cancels browsing on blur and ignores a late selection after account change", async () => {
  let resolve!: () => void;
  mockSelect.mockReturnValue(new Promise<void>((r) => (resolve = r)));
  const r = renderWithTheme(<TogetherHubContainer />);
  await act(async () => {});
  fireEvent.press(r.getByText("View and join"));
  mockUser = "other";
  r.rerender(<TogetherHubContainer />);
  await act(async () => resolve());
  expect(mockPush).not.toHaveBeenCalled();
  r.unmount();
  expect(mockCancel).toHaveBeenCalledTimes(1);
});
it("resumes own work and contains unavailable-discovery failures", async () => {
  mockActive = { together: { transport: "lan" } };
  const r = renderWithTheme(<TogetherHubContainer />);
  fireEvent.press(r.getByText("Back to my workout"));
  expect(mockPush).toHaveBeenCalledWith("/(app)/session");
  mockActive = null;
  mockBrowse.mockRejectedValue(new Error("permission"));
  r.rerender(<TogetherHubContainer />);
  await act(async () => {});
  mockSelect.mockRejectedValue(new Error("expired"));
  fireEvent.press(r.getByText("View and join"));
  await act(async () => {});
});
it("keeps an offline partner hub usable when native discovery is unavailable and contains cleanup errors", async () => {
  mockHasLobby = false;
  const r = renderWithTheme(<TogetherHubContainer />);
  expect(r.getByText("Join a session")).toBeTruthy();
  r.unmount();
  expect(mockBrowse).not.toHaveBeenCalled();
  mockHasLobby = true;
  mockCancel.mockRejectedValue(new Error("native"));
  const next = renderWithTheme(<TogetherHubContainer />);
  await act(async () => {});
  next.unmount();
  await act(async () => {});
});
