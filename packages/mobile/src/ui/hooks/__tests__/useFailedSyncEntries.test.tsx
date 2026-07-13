import { renderHook, act, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { AppState } from "react-native";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryAuthAdapter } from "@/adapters/auth/__tests__/in-memory-auth.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import { StubHealthAdapter } from "@/adapters/health";
import { StubNotificationsAdapter } from "@/adapters/notifications";
import { MockPaymentsAdapter } from "@/adapters/payments/__tests__/mock.adapter";
import { InMemoryNetInfoAdapter } from "@/adapters/netInfo/__tests__/InMemoryNetInfoAdapter";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import {
  EMPTY_SUMMARY,
  FAILED_SYNC_POLL_INTERVAL_MS,
  useFailedSyncEntries,
} from "@/ui/hooks/useFailedSyncEntries";

function wrapper(adapters: Adapters) {
  function TestWrapper({ children }: { children: ReactNode }) {
    return <AdapterProvider adapters={adapters}>{children}</AdapterProvider>;
  }
  return TestWrapper;
}

function makeAdapters(): {
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
    netInfo: new InMemoryNetInfoAdapter(),
  };
  return { adapters, storage };
}

function enqueueAndExhaust(
  storage: InMemoryStorageAdapter,
  entityType = "workout",
): number {
  storage.enqueueMutation({
    entityType,
    operation: "create",
    payload: {},
    endpoint: "/workouts",
    method: "POST",
  });
  const id = storage.getPendingMutations().slice(-1)[0].id;
  storage.markMutationFailed(id, "e1");
  storage.markMutationFailed(id, "e2");
  storage.markMutationFailed(id, "e3");
  return id;
}

describe("useFailedSyncEntries", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("returns an empty summary when no entries are failed-exhausted", () => {
    const { adapters } = makeAdapters();
    const { result } = renderHook(() => useFailedSyncEntries(), {
      wrapper: wrapper(adapters),
    });
    expect(result.current.total).toBe(0);
    expect(result.current.entries).toEqual([]);
  });

  it("counts failed-exhausted entries", () => {
    const { adapters, storage } = makeAdapters();
    enqueueAndExhaust(storage);
    enqueueAndExhaust(storage);

    const { result } = renderHook(() => useFailedSyncEntries(), {
      wrapper: wrapper(adapters),
    });
    expect(result.current.total).toBe(2);
    expect(result.current.entries).toHaveLength(2);
  });

  it("does NOT count entries still within their retry budget", () => {
    const { adapters, storage } = makeAdapters();
    storage.enqueueMutation({
      entityType: "workout",
      operation: "create",
      payload: {},
      endpoint: "/workouts",
      method: "POST",
    });
    const id = storage.getPendingMutations()[0].id;
    storage.markMutationFailed(id, "e1"); // only 1 of 3 retries burned

    const { result } = renderHook(() => useFailedSyncEntries(), {
      wrapper: wrapper(adapters),
    });
    expect(result.current.total).toBe(0);
  });

  it("refresh() re-reads storage on demand without waiting for the poll", () => {
    const { adapters, storage } = makeAdapters();
    const { result } = renderHook(() => useFailedSyncEntries(), {
      wrapper: wrapper(adapters),
    });
    expect(result.current.total).toBe(0);

    enqueueAndExhaust(storage);
    act(() => {
      result.current.refresh();
    });
    expect(result.current.total).toBe(1);
  });

  it("re-reads storage on the polling interval", async () => {
    const { adapters, storage } = makeAdapters();
    const { result } = renderHook(() => useFailedSyncEntries(), {
      wrapper: wrapper(adapters),
    });
    expect(result.current.total).toBe(0);

    enqueueAndExhaust(storage);
    act(() => {
      jest.advanceTimersByTime(FAILED_SYNC_POLL_INTERVAL_MS);
    });
    await waitFor(() => expect(result.current.total).toBe(1));
  });

  it("exposes the polling interval constant so tests + ops can reason about cadence", () => {
    expect(FAILED_SYNC_POLL_INTERVAL_MS).toBe(30_000);
  });

  it("EMPTY_SUMMARY's default refresh is a safe no-op", () => {
    expect(EMPTY_SUMMARY.total).toBe(0);
    expect(EMPTY_SUMMARY.entries).toEqual([]);
    expect(() => EMPTY_SUMMARY.refresh()).not.toThrow();
  });

  it("re-reads storage on an AppState change to active", async () => {
    let activeListener: ((s: string) => void) | null = null;
    const addEventSpy = jest
      .spyOn(AppState, "addEventListener")
      .mockImplementation((event, cb) => {
        if (event === "change") activeListener = cb as (s: string) => void;
        return { remove: jest.fn() } as unknown as ReturnType<
          typeof AppState.addEventListener
        >;
      });

    const { adapters, storage } = makeAdapters();
    const { result } = renderHook(() => useFailedSyncEntries(), {
      wrapper: wrapper(adapters),
    });
    expect(result.current.total).toBe(0);

    enqueueAndExhaust(storage);
    act(() => {
      activeListener!("active");
    });
    await waitFor(() => expect(result.current.total).toBe(1));
    addEventSpy.mockRestore();
  });

  it("does NOT re-read storage on a non-active AppState transition", () => {
    let activeListener: ((s: string) => void) | null = null;
    const addEventSpy = jest
      .spyOn(AppState, "addEventListener")
      .mockImplementation((event, cb) => {
        if (event === "change") activeListener = cb as (s: string) => void;
        return { remove: jest.fn() } as unknown as ReturnType<
          typeof AppState.addEventListener
        >;
      });

    const { adapters, storage } = makeAdapters();
    const { result } = renderHook(() => useFailedSyncEntries(), {
      wrapper: wrapper(adapters),
    });

    enqueueAndExhaust(storage);
    act(() => {
      activeListener!("background");
    });
    // Background transitions don't trigger a refresh — still 0.
    expect(result.current.total).toBe(0);
    addEventSpy.mockRestore();
  });
});
