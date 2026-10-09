import React from "react";
import { Alert } from "react-native";
import { renderHook, act } from "@testing-library/react-native";
import { useDiscardWorkout } from "../useDiscardWorkout";
let mockOwn: any, mockChannel: any;
const mockDiscard = jest.fn(),
  mockCancel = jest.fn(),
  mockClear = jest.fn(),
  mockInvalidate = jest.fn(),
  mockDismiss = jest.fn(),
  mockEnd = jest.fn(),
  mockSolo = jest.fn();
const mockStorage = {
  getActiveSession: () => mockOwn,
  clearActiveSession: (...a: any[]) => mockClear(...a),
  invalidateDashboard: (...a: any[]) => mockInvalidate(...a),
};
const mockLobby: any = {
  workout: { discard: (...a: any[]) => mockDiscard(...a) },
  getSnapshot: () => ({
    sessionId: mockChannel.sessionId,
    role: "host",
    members: [{ userId: "u" }],
  }),
  get shared() {
    return mockChannel;
  },
  cancel: (...a: any[]) => mockCancel(...a),
};
const mockCloud = { discardDraft: (...a: any[]) => mockDiscard(...a) };
jest.mock("../useAdapters", () => ({
  useAdapters: () => ({
    storage: mockStorage,
    togetherLobby: mockLobby,
    togetherCloud: mockCloud,
  }),
}));
jest.mock("expo-router", () => ({
  router: { dismissAll: (...a: any[]) => mockDismiss(...a) },
}));
jest.mock("@/state/active-workout", () => ({
  useActiveWorkout: {
    getState: () => ({
      active: { sessionId: "own" },
      end: (...a: any[]) => mockEnd(...a),
    }),
  },
}));
jest.mock("@/application/commands/session", () => ({
  cancelSessionCommand: (...a: any[]) => mockSolo(...a),
}));
beforeEach(() => {
  jest.clearAllMocks();
  mockLobby.getSnapshot = () => ({
    sessionId: mockChannel.sessionId,
    role: "host",
    members: [{ userId: "u" }],
  });
  mockOwn = { id: "own", userId: "u", together: { transport: "lan" } };
  mockChannel = { sessionId: "shared-own", close: jest.fn(async () => {}) };
  mockDiscard.mockImplementation(() => {});
  mockCancel.mockResolvedValue(undefined);
  mockSolo.mockReturnValue({ ok: true });
  jest.spyOn(Alert, "alert").mockImplementation(() => {});
});
const confirm = () =>
  jest
    .mocked(Alert.alert)
    .mock.calls.at(-1)![2]!
    .find((b) => b.text === "Discard workout")!.onPress!;
it.each(["lan", "cloud"])(
  "discards %s durably only after explicit confirmation with no rating or history save",
  async (transport) => {
    mockOwn.together.transport = transport;
    const { result } = renderHook(() => useDiscardWorkout("u", "own"));
    act(() => result.current());
    expect(mockDiscard).not.toHaveBeenCalled();
    await act(async () => confirm()());
    expect(mockDiscard).toHaveBeenCalledWith("u", "own");
    expect(mockClear).toHaveBeenCalledWith("u");
    expect(mockInvalidate).toHaveBeenCalledWith("u");
    expect(mockEnd).toHaveBeenCalled();
    expect(mockDismiss).toHaveBeenCalled();
    if (transport === "lan") {
      expect(mockChannel.close).toHaveBeenCalledWith("save_own");
      expect(mockCancel).toHaveBeenCalled();
    }
  },
);
it.each(["account", "workout", "unmount", "cache"])(
  "ignores a retained confirmation after %s changes",
  async (reason) => {
    let user = "u",
      id = "own";
    const r = renderHook(() => useDiscardWorkout(user, id));
    act(() => r.result.current());
    const retained = confirm();
    if (reason === "account") user = "other";
    if (reason === "workout") id = "new";
    if (reason === "cache") mockOwn = { id: "new", userId: "u" };
    if (reason === "unmount") r.unmount();
    else r.rerender({});
    await act(async () => retained());
    expect(mockDiscard).not.toHaveBeenCalled();
    expect(mockDismiss).not.toHaveBeenCalled();
  },
);
it("does not apply an old entry callback to a new account and ignores missing identity", () => {
  let user: string | null = "u";
  const r = renderHook(() => useDiscardWorkout(user, "own"));
  const retained = r.result.current;
  user = "other";
  r.rerender({});
  act(() => retained());
  expect(Alert.alert).not.toHaveBeenCalled();
  user = null;
  r.rerender({});
  act(() => r.result.current());
  expect(Alert.alert).not.toHaveBeenCalled();
});
it("keeps durable work when retirement fails", async () => {
  mockDiscard.mockImplementation(() => {
    throw new Error("disk");
  });
  const r = renderHook(() => useDiscardWorkout("u", "own"));
  act(() => r.result.current());
  await act(async () => confirm()());
  expect(mockClear).not.toHaveBeenCalled();
  expect(mockDismiss).not.toHaveBeenCalled();
  expect(Alert.alert).toHaveBeenLastCalledWith(
    "Workout kept on this device",
    expect.any(String),
  );
});
it("cannot cancel a new sharing channel after a late close acknowledgement", async () => {
  let release!: () => void;
  mockChannel.close.mockReturnValue(new Promise<void>((r) => (release = r)));
  const r = renderHook(() => useDiscardWorkout("u", "own"));
  act(() => r.result.current());
  act(() => confirm()());
  mockChannel = { close: jest.fn() };
  await act(async () => release());
  expect(mockCancel).not.toHaveBeenCalled();
});
it("supports a personal-workout discard and preserves it on failure", async () => {
  mockOwn.together = undefined;
  const r = renderHook(() => useDiscardWorkout("u", "own"));
  act(() => r.result.current());
  await act(async () => confirm()());
  expect(mockSolo).toHaveBeenCalled();
  expect(mockDiscard).not.toHaveBeenCalled();
  mockSolo.mockReturnValue({ ok: false });
  act(() => r.result.current());
  await act(async () => confirm()());
  expect(Alert.alert).toHaveBeenLastCalledWith(
    "Workout kept on this device",
    expect.any(String),
  );
});
it("leaves a guest without terminating its peers and contains close or cancellation failures", async () => {
  mockLobby.getSnapshot = () => ({
    sessionId: mockChannel.sessionId,
    role: "guest",
    members: [{ userId: "u" }],
  });
  mockChannel.close.mockRejectedValue(new Error("network"));
  mockCancel.mockRejectedValue(new Error("native"));
  const r = renderHook(() => useDiscardWorkout("u", "own"));
  act(() => r.result.current());
  await act(async () => confirm()());
  expect(mockChannel.close).toHaveBeenCalledWith("leave");
  expect(mockDismiss).toHaveBeenCalled();
});
it("discards its draft safely even when it has no live transport membership", async () => {
  mockLobby.getSnapshot = () => ({ role: "guest", members: [] });
  const r = renderHook(() => useDiscardWorkout("u", "own"));
  act(() => r.result.current());
  await act(async () => confirm()());
  expect(mockChannel.close).not.toHaveBeenCalled();
  expect(mockDiscard).toHaveBeenCalled();
});
