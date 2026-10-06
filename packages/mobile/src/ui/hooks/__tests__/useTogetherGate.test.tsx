import { act, renderHook } from "@testing-library/react-native";
import type { TogetherAccessSnapshot } from "@/domain/ports/togetherProvisioning.port";
import { useTogetherGate } from "../useTogetherGate";

let mockAccount: string | null = "athlete";
let mockAuthLoading = false;
let mockProvisioningAvailable = true;
let mockSnapshot: TogetherAccessSnapshot;
const mockListeners = new Set<() => void>();
const mockRefresh = jest.fn(async () => {});
const mockConnected = jest.fn(async () => false);
const mockPush = jest.fn();
const mockProvisioning = {
  getAccessSnapshot: () => mockSnapshot,
  subscribeAccess: (listener: () => void) => {
    mockListeners.add(listener);
    return () => {
      mockListeners.delete(listener);
    };
  },
  refreshAccess: mockRefresh,
};
jest.mock("../useAdapters", () => ({
  useAdapters: () => ({
    togetherProvisioning: mockProvisioningAvailable
      ? mockProvisioning
      : undefined,
    netInfo: { isConnected: mockConnected },
  }),
}));
jest.mock("../useAuth", () => ({
  useAuth: () => ({
    session: mockAccount ? { userId: mockAccount } : null,
    isLoading: mockAuthLoading,
  }),
}));
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }) }));

beforeEach(() => {
  jest.clearAllMocks();
  mockListeners.clear();
  mockAccount = "athlete";
  mockAuthLoading = false;
  mockProvisioningAvailable = true;
  mockSnapshot = { accountId: "athlete", state: "pending", expiresAt: null };
});
it("observes verified offline access without fetching subscription or preparing on mount", () => {
  const { result } = renderHook(() => useTogetherGate());
  expect(result.current.allowed).toBe(false);
  expect(mockRefresh).not.toHaveBeenCalled();
  act(() => {
    mockSnapshot = { accountId: "athlete", state: "allowed", expiresAt: 123 };
    mockListeners.forEach((listener) => listener());
  });
  expect(result.current.allowed).toBe(true);
  act(() => {
    mockSnapshot = {
      accountId: "athlete",
      state: "unavailable",
      expiresAt: null,
      error: "expired",
    };
    mockListeners.forEach((listener) => listener());
  });
  expect(result.current.state).toBe("unavailable");
  expect(result.current.allowed).toBe(false);
});
it("rejects stale account access synchronously and does not retry for that account", async () => {
  mockSnapshot = { accountId: "old-account", state: "allowed", expiresAt: 123 };
  const { result, rerender } = renderHook(() => useTogetherGate());
  expect(result.current.state).toBe("pending");
  await act(async () => {
    await result.current.retry();
  });
  expect(mockRefresh).not.toHaveBeenCalled();
  mockAccount = null;
  rerender({});
  expect(result.current.state).toBe("unavailable");
});
it("retries through the secret-free adapter and routes the explicit upgrade action", async () => {
  mockSnapshot = {
    accountId: "athlete",
    state: "locked",
    expiresAt: null,
    error: "paid-required",
  };
  const { result } = renderHook(() => useTogetherGate());
  expect(result.current.state).toBe("locked");
  await act(async () => {
    await result.current.retry();
  });
  expect(mockRefresh).toHaveBeenCalledWith({ online: false });
  act(() => result.current.onUpgrade());
  expect(mockPush).toHaveBeenCalledWith(
    "/(auth)/subscription-selection?tier=premium&cycle=monthly",
  );
});

it("bounds pending bootstrap and restores allowed when late verified proof arrives", () => {
  jest.useFakeTimers();
  try {
    const { result } = renderHook(() => useTogetherGate());
    act(() => jest.advanceTimersByTime(8000));
    expect(result.current.state).toBe("unavailable");
    expect(result.current.error).toBe("unavailable");
    act(() => {
      mockSnapshot = { accountId: "athlete", state: "allowed", expiresAt: 123 };
      mockListeners.forEach((listener) => listener());
    });
    expect(result.current.allowed).toBe(true);
  } finally {
    jest.useRealTimers();
  }
});
it("bounded retry checks cached proof when native connectivity never answers", async () => {
  jest.useFakeTimers();
  try {
    mockConnected.mockReturnValueOnce(new Promise(() => {}));
    const { result } = renderHook(() => useTogetherGate());
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.retry();
    });
    await act(async () => {
      jest.advanceTimersByTime(1500);
      await pending;
    });
    expect(mockRefresh).toHaveBeenCalledWith({ online: false });
  } finally {
    jest.useRealTimers();
  }
});
it("does not retry after the hook's account changes while connectivity is pending", async () => {
  let resolve!: (value: boolean) => void;
  mockConnected.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const { result, rerender } = renderHook(() => useTogetherGate());
  let pending!: Promise<void>;
  act(() => {
    pending = result.current.retry();
  });
  mockAccount = "other";
  rerender({});
  await act(async () => {
    resolve(true);
    await pending;
  });
  expect(mockRefresh).not.toHaveBeenCalled();
});

it("keeps independent auth bootstrap pending until its account matches verified access", () => {
  jest.useFakeTimers();
  try {
    mockAccount = null;
    mockAuthLoading = true;
    mockSnapshot = { accountId: "athlete", state: "allowed", expiresAt: 123 };
    const { result, rerender } = renderHook(() => useTogetherGate());
    expect(result.current.state).toBe("pending");
    act(() => jest.advanceTimersByTime(8000));
    expect(result.current.state).toBe("pending");
    mockAccount = "athlete";
    mockAuthLoading = false;
    rerender({});
    expect(result.current.allowed).toBe(true);
  } finally {
    jest.useRealTimers();
  }
});
it("only classifies a null auth session as unavailable after bootstrap settles", () => {
  mockAccount = null;
  mockAuthLoading = true;
  const { result, rerender } = renderHook(() => useTogetherGate());
  expect(result.current.state).toBe("pending");
  mockAuthLoading = false;
  rerender({});
  expect(result.current.state).toBe("unavailable");
});

it("fails closed without optional native provisioning and keeps retry inert", async () => {
  mockProvisioningAvailable = false;
  const { result, unmount } = renderHook(() => useTogetherGate());
  expect(result.current.state).toBe("unavailable");
  expect(result.current.allowed).toBe(false);
  await act(async () => {
    await result.current.retry();
  });
  expect(mockConnected).not.toHaveBeenCalled();
  expect(mockRefresh).not.toHaveBeenCalled();
  unmount();
});
it("does not request authorization while signed out", async () => {
  mockAccount = null;
  const { result } = renderHook(() => useTogetherGate());
  await act(async () => {
    await result.current.retry();
  });
  expect(result.current.state).toBe("unavailable");
  expect(mockConnected).not.toHaveBeenCalled();
  expect(mockRefresh).not.toHaveBeenCalled();
});
it("uses cached verification when the native connectivity lookup throws", async () => {
  mockConnected.mockRejectedValueOnce(
    new Error("native connectivity unavailable"),
  );
  const { result } = renderHook(() => useTogetherGate());
  await act(async () => {
    await result.current.retry();
  });
  expect(mockRefresh).toHaveBeenCalledWith({ online: false });
  expect(result.current.allowed).toBe(false);
});
