import { renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { AuthSession } from "@/domain/ports/auth.port";
import type { WorkoutHistory } from "@/domain/models/workout";
import { ok } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import { useWorkoutHistory } from "@/ui/hooks/useWorkoutHistory";

function makeAdapters(
  api: InMemoryApiAdapter,
  storage: InMemoryStorageAdapter,
): Adapters {
  const session: AuthSession = {
    accessToken: "t",
    refreshToken: "r",
    userId: "user-1",
    email: "u@example.com",
    expiresAt: Date.now() + 60_000,
  };
  const auth = {
    getSession: jest.fn(async () => ok(session)),
    onAuthStateChange: jest.fn((cb: (s: AuthSession | null) => void) => {
      cb(session);
      return () => {};
    }),
    getAccessToken: jest.fn(async () => "t"),
  } as unknown as Adapters["auth"];
  return {
    api,
    auth,
    storage,
    health: {} as Adapters["health"],
    notifications: {} as Adapters["notifications"],
    payments: {} as Adapters["payments"],
    netInfo: {} as Adapters["netInfo"],
  };
}

function wrap(adapters: Adapters) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <AdapterProvider adapters={adapters}>{children}</AdapterProvider>;
  };
}

const HISTORY: WorkoutHistory = {
  completedCount: 5,
  lastCompletedAt: "2026-07-01T00:00:00Z",
  avgDurationSeconds: 2400,
  lastSession: {
    completedAt: "2026-07-01T00:00:00Z",
    totalVolumeKg: 5000,
    durationSeconds: 2500,
  },
};

const CACHED: WorkoutHistory = { ...HISTORY, completedCount: 9 };

describe("useWorkoutHistory", () => {
  it("stays null with no fetch when workoutId is null", () => {
    const api = new InMemoryApiAdapter();
    const spy = jest.spyOn(api, "getWorkoutHistory");
    const { result } = renderHook(() => useWorkoutHistory(null), {
      wrapper: wrap(makeAdapters(api, new InMemoryStorageAdapter())),
    });
    expect(result.current.history).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it("skips the round-trip for optimistic local- ids", () => {
    const api = new InMemoryApiAdapter();
    const spy = jest.spyOn(api, "getWorkoutHistory");
    const { result } = renderHook(() => useWorkoutHistory("local-123"), {
      wrapper: wrap(makeAdapters(api, new InMemoryStorageAdapter())),
    });
    expect(result.current.history).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it("fetches + caches when there is no cached row", async () => {
    const api = new InMemoryApiAdapter();
    api.workoutHistory.set("w-1", HISTORY);
    const storage = new InMemoryStorageAdapter();
    const { result } = renderHook(() => useWorkoutHistory("w-1"), {
      wrapper: wrap(makeAdapters(api, storage)),
    });
    await waitFor(() => expect(result.current.history).toEqual(HISTORY));
    expect(result.current.error).toBeNull();
    // Written through to the cache for next time.
    expect(storage.getCachedWorkoutHistory("user-1", "w-1")?.history).toEqual(
      HISTORY,
    );
  });

  it("renders a fresh cached row synchronously without fetching (cache-first)", () => {
    const api = new InMemoryApiAdapter();
    const spy = jest.spyOn(api, "getWorkoutHistory");
    const storage = new InMemoryStorageAdapter();
    storage.cacheWorkoutHistory("user-1", "w-1", CACHED); // syncedAt = now → fresh
    const { result } = renderHook(() => useWorkoutHistory("w-1"), {
      wrapper: wrap(makeAdapters(api, storage)),
    });
    expect(result.current.history).toEqual(CACHED);
    expect(result.current.isLoading).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it("keeps the cached history when a stale-triggered refresh errors (offline)", async () => {
    const api = new InMemoryApiAdapter();
    api.shouldFail = true;
    const storage = new InMemoryStorageAdapter();
    storage.cacheWorkoutHistory("user-1", "w-1", CACHED);
    // Force the cached row stale by ageing its syncedAt (the in-memory
    // adapter returns the stored object by reference).
    const entry = storage.getCachedWorkoutHistory("user-1", "w-1");
    if (entry)
      (entry as { syncedAt: string }).syncedAt = "2020-01-01T00:00:00Z";

    const { result } = renderHook(() => useWorkoutHistory("w-1"), {
      wrapper: wrap(makeAdapters(api, storage)),
    });
    // Cached value shown immediately (cache-first).
    expect(result.current.history).toEqual(CACHED);
    // Stale → background refresh fires → errors. Wait on the committed error.
    await waitFor(() => expect(result.current.error).not.toBeNull());
    // Error is non-fatal — cached history is retained, not nulled.
    expect(result.current.history).toEqual(CACHED);
  });

  it("does not fetch when there is no auth session (userId null)", () => {
    const api = new InMemoryApiAdapter();
    const spy = jest.spyOn(api, "getWorkoutHistory");
    const adapters = makeAdapters(api, new InMemoryStorageAdapter());
    // No session resolves.
    (adapters.auth.getSession as jest.Mock).mockResolvedValue(
      ok(null as never),
    );
    (adapters.auth.onAuthStateChange as jest.Mock).mockImplementation(
      (cb: (s: unknown) => void) => {
        cb(null);
        return () => {};
      },
    );
    const { result } = renderHook(() => useWorkoutHistory("w-1"), {
      wrapper: wrap(adapters),
    });
    expect(result.current.history).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it("refreshes a stale cached row to the fresh server value", async () => {
    const api = new InMemoryApiAdapter();
    api.workoutHistory.set("w-1", HISTORY); // fresh server value
    const storage = new InMemoryStorageAdapter();
    storage.cacheWorkoutHistory("user-1", "w-1", CACHED);
    const entry = storage.getCachedWorkoutHistory("user-1", "w-1");
    if (entry)
      (entry as { syncedAt: string }).syncedAt = "2020-01-01T00:00:00Z";

    const { result } = renderHook(() => useWorkoutHistory("w-1"), {
      wrapper: wrap(makeAdapters(api, storage)),
    });
    // Cache-first: shows the stale cached value, then swaps to the fresh fetch.
    expect(result.current.history).toEqual(CACHED);
    await waitFor(() => expect(result.current.history).toEqual(HISTORY));
    expect(storage.getCachedWorkoutHistory("user-1", "w-1")?.history).toEqual(
      HISTORY,
    );
  });

  it("renders null (non-fatal) on error with no cache", async () => {
    const api = new InMemoryApiAdapter();
    api.shouldFail = true;
    const { result } = renderHook(() => useWorkoutHistory("w-1"), {
      wrapper: wrap(makeAdapters(api, new InMemoryStorageAdapter())),
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.history).toBeNull();
    expect(result.current.error).not.toBeNull();
  });
});
