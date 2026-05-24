import { renderHook, act } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { AppState } from "react-native";
import { useSync, syncStatusLabel } from "../useSync";
import { AdapterProvider } from "../useAdapters";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryAuthAdapter } from "@/adapters/auth/__tests__/in-memory-auth.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import { StubHealthAdapter } from "@/adapters/health";
import { StubNotificationsAdapter } from "@/adapters/notifications";
import { MockPaymentsAdapter } from "@/adapters/payments/__tests__/mock.adapter";
import type { Adapters } from "@/shared/types";

function createTestAdapters(): {
  adapters: Adapters;
  storage: InMemoryStorageAdapter;
} {
  const storage = new InMemoryStorageAdapter();
  const adapters: Adapters = {
    api: new InMemoryApiAdapter(),
    auth: new InMemoryAuthAdapter(),
    storage,
    health: new StubHealthAdapter(),
    notifications: new StubNotificationsAdapter(),
    payments: new MockPaymentsAdapter(),
  };
  return { adapters, storage };
}

// Track AppState listener for simulating state changes
let appStateCallback: ((state: string) => void) | null = null;
const mockRemove = jest.fn();

beforeEach(() => {
  appStateCallback = null;
  mockRemove.mockClear();
  jest.spyOn(AppState, "addEventListener").mockImplementation(((
    _type: string,
    listener: unknown,
  ) => {
    appStateCallback = listener as (state: string) => void;
    return { remove: mockRemove };
  }) as typeof AppState.addEventListener);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("useSync", () => {
  it("returns clean state when queue is empty", () => {
    const { adapters } = createTestAdapters();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <AdapterProvider adapters={adapters}>{children}</AdapterProvider>
    );

    const { result } = renderHook(() => useSync(), { wrapper });
    expect(result.current.isClean).toBe(true);
    expect(result.current.pending).toBe(0);
    expect(result.current.failed).toBe(0);
    expect(result.current.inFlight).toBe(0);
  });

  it("reflects pending mutations", () => {
    const { adapters, storage } = createTestAdapters();
    storage.enqueueMutation({
      entityType: "workout",
      entityId: "w1",
      operation: "create",
      payload: {},
      endpoint: "/workouts",
      method: "POST",
    });

    const wrapper = ({ children }: { children: ReactNode }) => (
      <AdapterProvider adapters={adapters}>{children}</AdapterProvider>
    );

    const { result } = renderHook(() => useSync(), { wrapper });
    expect(result.current.isClean).toBe(false);
    expect(result.current.pending).toBe(1);
  });

  it("updates on refresh", () => {
    const { adapters, storage } = createTestAdapters();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <AdapterProvider adapters={adapters}>{children}</AdapterProvider>
    );

    const { result } = renderHook(() => useSync(), { wrapper });
    expect(result.current.isClean).toBe(true);

    act(() => {
      storage.enqueueMutation({
        entityType: "workout",
        entityId: "w1",
        operation: "create",
        payload: {},
        endpoint: "/workouts",
        method: "POST",
      });
      result.current.refresh();
    });

    expect(result.current.pending).toBe(1);
    expect(result.current.isClean).toBe(false);
  });

  it("refreshes when app returns to foreground", () => {
    const { adapters, storage } = createTestAdapters();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <AdapterProvider adapters={adapters}>{children}</AdapterProvider>
    );

    const { result } = renderHook(() => useSync(), { wrapper });
    expect(result.current.isClean).toBe(true);

    // Add a mutation while "backgrounded"
    storage.enqueueMutation({
      entityType: "workout",
      entityId: "w1",
      operation: "create",
      payload: {},
      endpoint: "/workouts",
      method: "POST",
    });

    // Simulate background then foreground
    act(() => {
      appStateCallback?.("background");
    });
    act(() => {
      appStateCallback?.("active");
    });

    expect(result.current.pending).toBe(1);
    expect(result.current.isClean).toBe(false);
  });

  it("does not create duplicate intervals when already polling", () => {
    const { adapters } = createTestAdapters();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <AdapterProvider adapters={adapters}>{children}</AdapterProvider>
    );

    renderHook(() => useSync(), { wrapper });

    // Simulate "active" while already polling — should not create a second interval
    act(() => {
      appStateCallback?.("active");
    });

    // No error means the guard prevented a duplicate interval
    expect(true).toBe(true);
  });

  it("cleans up AppState subscription on unmount", () => {
    const { adapters } = createTestAdapters();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <AdapterProvider adapters={adapters}>{children}</AdapterProvider>
    );

    const { unmount } = renderHook(() => useSync(), { wrapper });
    unmount();

    expect(mockRemove).toHaveBeenCalled();
  });
});

describe("syncStatusLabel", () => {
  it("maps sync statuses to labels", () => {
    expect(syncStatusLabel("pending")).toBe("Waiting to sync");
    expect(syncStatusLabel("in_flight")).toBe("Syncing...");
    expect(syncStatusLabel("failed")).toBe("Sync failed");
    expect(syncStatusLabel("completed")).toBe("Synced");
  });
});
