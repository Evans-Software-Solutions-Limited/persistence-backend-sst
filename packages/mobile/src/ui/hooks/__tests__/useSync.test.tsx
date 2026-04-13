import { renderHook, act } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { useSync, syncStatusLabel } from "../useSync";
import { AdapterProvider } from "../useAdapters";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryAuthAdapter } from "@/adapters/auth/__tests__/in-memory-auth.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import { StubHealthAdapter } from "@/adapters/health";
import { StubNotificationsAdapter } from "@/adapters/notifications";
import { StubPaymentsAdapter } from "@/adapters/payments";
import type { Adapters } from "@/shared/types";

function createTestAdapters(overrides?: Partial<Adapters>): {
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
    payments: new StubPaymentsAdapter(),
    ...overrides,
  };
  return { adapters, storage };
}

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
});

describe("syncStatusLabel", () => {
  it("maps sync statuses to labels", () => {
    expect(syncStatusLabel("pending")).toBe("Waiting to sync");
    expect(syncStatusLabel("in_flight")).toBe("Syncing...");
    expect(syncStatusLabel("failed")).toBe("Sync failed");
    expect(syncStatusLabel("completed")).toBe("Synced");
  });
});
