import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { DASHBOARD_FIXTURE } from "@/adapters/api/__tests__/fixtures/dashboard.fixture";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { AuthSession } from "@/domain/ports/auth.port";
import { DASHBOARD_STALE_AFTER_MS } from "@/domain/models/dashboard";
import { ok } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import { useDashboard } from "@/ui/hooks/useDashboard";

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
  const listeners: ((s: AuthSession | null) => void)[] = [];
  const auth = {
    signInWithEmail: jest.fn(),
    signUpWithEmail: jest.fn(),
    signInWithOAuth: jest.fn(),
    signOut: jest.fn(),
    getSession: jest.fn(async () => ok(session)),
    onAuthStateChange: jest.fn((cb: (s: AuthSession | null) => void) => {
      listeners.push(cb);
      // fire immediately so the useAuth bootstrap resolves fast
      setTimeout(() => cb(session), 0);
      return () => {};
    }),
    resetPassword: jest.fn(),
    refreshSession: jest.fn(),
    getAccessToken: jest.fn(async () => "t"),
  } as unknown as Adapters["auth"];
  return {
    api,
    auth,
    storage,
    health: {
      isAvailable: jest.fn(async () => false),
      requestPermissions: jest.fn(),
      getPermissionStatus: jest.fn(async () => ({
        steps: "not_determined",
        calories: "not_determined",
        bodyWeight: "not_determined",
        heartRate: "not_determined",
      })),
      getStepsToday: jest.fn(),
      getActiveCaloriesToday: jest.fn(),
      getLatestBodyWeight: jest.fn(),
      getHeartRateLatest: jest.fn(),
      writeBodyWeight: jest.fn(),
      disconnect: jest.fn(),
    } as unknown as Adapters["health"],
    notifications: {} as Adapters["notifications"],
    payments: {} as Adapters["payments"],
  };
}

function wrap(adapters: Adapters) {
  function Wrapper({ children }: { children: ReactNode }) {
    return <AdapterProvider adapters={adapters}>{children}</AdapterProvider>;
  }
  return Wrapper;
}

describe("useDashboard", () => {
  it("renders null payload and auto-refreshes when cache is empty", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    api.dashboard = DASHBOARD_FIXTURE;
    const adapters = makeAdapters(api, storage);

    const { result } = renderHook(() => useDashboard(), {
      wrapper: wrap(adapters),
    });

    // Initial render: no cache
    expect(result.current.payload).toBeNull();
    expect(result.current.isStale).toBe(true);

    // Auto-refresh should eventually populate the cache + payload
    await waitFor(() => {
      expect(result.current.payload).toEqual(DASHBOARD_FIXTURE);
    });
    expect(result.current.isStale).toBe(false);
  });

  it("exposes cached payload on mount when already fresh", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    api.dashboard = DASHBOARD_FIXTURE;
    storage.cacheDashboard("user-1", DASHBOARD_FIXTURE);
    const adapters = makeAdapters(api, storage);

    const { result } = renderHook(() => useDashboard(), {
      wrapper: wrap(adapters),
    });
    // waitFor to let useAuth settle (session arrives via setTimeout(0))
    await waitFor(() => {
      expect(result.current.payload).not.toBeNull();
    });
    expect(result.current.payload).toEqual(DASHBOARD_FIXTURE);
    expect(result.current.isStale).toBe(false);
  });

  it("does not fire a refresh on bootstrap when the cache is fresh", async () => {
    // Regression for bugbot finding on PR #37: the auto-refresh effect
    // read `isStale` from useState, which lagged `initial.isStale` by
    // one render. When userId transitioned from null to "user-1"
    // during the auth bootstrap, the state variable was still `true`
    // (from the null-user branch) even though `initial.isStale` was
    // already `false` (cache hit). Result: every app open briefly
    // flashed isRefreshing=true against a perfectly fresh cache.
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    api.dashboard = DASHBOARD_FIXTURE;
    storage.cacheDashboard("user-1", DASHBOARD_FIXTURE);
    const getDashboardSpy = jest.spyOn(api, "getDashboard");
    const adapters = makeAdapters(api, storage);

    const { result } = renderHook(() => useDashboard(), {
      wrapper: wrap(adapters),
    });
    // Wait for the cached payload to propagate into state (proves the
    // auth bootstrap + cache read completed).
    await waitFor(() => {
      expect(result.current.payload).not.toBeNull();
    });
    // Give any spurious auto-refresh a tick to fire. Before the fix
    // this window saw a GET /dashboard call; after the fix it stays at
    // zero because the cache was fresh at auth-bootstrap time.
    await new Promise((r) => setTimeout(r, 50));

    expect(getDashboardSpy).toHaveBeenCalledTimes(0);
    expect(result.current.isRefreshing).toBe(false);
  });

  it("surfaces API error on refresh failure but keeps cached payload", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    storage.cacheDashboard("user-1", DASHBOARD_FIXTURE);
    // Force stale so refresh fires
    const oldSynced = new Date(
      Date.now() - DASHBOARD_STALE_AFTER_MS - 60_000,
    ).toISOString();
    const existing = storage.getCachedDashboard("user-1");
    // Rewrite the cache entry with stale syncedAt by setting directly.
    if (existing) {
      (
        storage as unknown as {
          dashboardCache: Map<
            string,
            {
              userId: string;
              payload: typeof DASHBOARD_FIXTURE;
              syncedAt: string;
            }
          >;
        }
      ).dashboardCache.set("user-1", {
        userId: "user-1",
        payload: DASHBOARD_FIXTURE,
        syncedAt: oldSynced,
      });
    }
    api.shouldFail = true;
    api.dashboard = DASHBOARD_FIXTURE;
    const adapters = makeAdapters(api, storage);

    const { result } = renderHook(() => useDashboard(), {
      wrapper: wrap(adapters),
    });
    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });
    // Cached payload survives the failed refresh
    expect(result.current.payload).toEqual(DASHBOARD_FIXTURE);
  });

  it("refresh() re-fetches and writes through", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    storage.cacheDashboard("user-1", DASHBOARD_FIXTURE);
    api.dashboard = DASHBOARD_FIXTURE;
    const adapters = makeAdapters(api, storage);

    const { result } = renderHook(() => useDashboard(), {
      wrapper: wrap(adapters),
    });
    await waitFor(() => {
      expect(result.current.payload).not.toBeNull();
    });

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.isRefreshing).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("re-arms the auto-refresh guard when userId changes (sign-out → sign-in as a different user)", async () => {
    // Regression for bugbot finding on PR #37: hasAutoRefreshedRef was
    // set to true for user-1 and never reset. When user-1 signed out
    // and user-2 signed in (same hook instance), the stale-cache auto-
    // refresh skipped — Home tab sat empty until manual pull-to-refresh.
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    api.dashboard = DASHBOARD_FIXTURE;

    // Listeners registered via auth.onAuthStateChange; fired manually
    // from the test to simulate sign-out → sign-in.
    const listeners: ((s: AuthSession | null) => void)[] = [];
    const user1: AuthSession = {
      accessToken: "t1",
      refreshToken: "r1",
      userId: "user-1",
      email: "u1@example.com",
      expiresAt: Date.now() + 60_000,
    };
    const user2: AuthSession = {
      accessToken: "t2",
      refreshToken: "r2",
      userId: "user-2",
      email: "u2@example.com",
      expiresAt: Date.now() + 60_000,
    };

    let currentSession: AuthSession | null = user1;
    const auth = {
      signInWithEmail: jest.fn(),
      signUpWithEmail: jest.fn(),
      signInWithOAuth: jest.fn(),
      signOut: jest.fn(),
      getSession: jest.fn(async () => ok(currentSession)),
      onAuthStateChange: jest.fn((cb: (s: AuthSession | null) => void) => {
        listeners.push(cb);
        setTimeout(() => cb(currentSession), 0);
        return () => {};
      }),
      resetPassword: jest.fn(),
      refreshSession: jest.fn(),
      getAccessToken: jest.fn(async () => currentSession?.accessToken ?? "t"),
    } as unknown as Adapters["auth"];

    const adapters: Adapters = {
      api,
      auth,
      storage,
      health: {
        isAvailable: jest.fn(async () => false),
        requestPermissions: jest.fn(),
        getPermissionStatus: jest.fn(async () => ({
          steps: "not_determined",
          calories: "not_determined",
          bodyWeight: "not_determined",
          heartRate: "not_determined",
        })),
        getStepsToday: jest.fn(),
        getActiveCaloriesToday: jest.fn(),
        getLatestBodyWeight: jest.fn(),
        getHeartRateLatest: jest.fn(),
        writeBodyWeight: jest.fn(),
        disconnect: jest.fn(),
      } as unknown as Adapters["health"],
      notifications: {} as Adapters["notifications"],
      payments: {} as Adapters["payments"],
    };

    const getDashboardSpy = jest.spyOn(api, "getDashboard");

    const { result } = renderHook(() => useDashboard(), {
      wrapper: wrap(adapters),
    });

    // user-1 auto-refresh fires (empty cache → stale)
    await waitFor(() => {
      expect(result.current.payload).toEqual(DASHBOARD_FIXTURE);
    });
    const callsAfterUser1 = getDashboardSpy.mock.calls.length;
    expect(callsAfterUser1).toBeGreaterThanOrEqual(1);

    // Sign out (session → null), then sign in as user-2.
    await act(async () => {
      currentSession = null;
      listeners.forEach((cb) => cb(null));
    });
    await act(async () => {
      currentSession = user2;
      listeners.forEach((cb) => cb(user2));
    });

    // user-2 has NO cache row, so the stale-cache auto-refresh must
    // fire again. Before the fix, it was guarded by the one-shot ref
    // left set from user-1 and never fired — this assertion proves the
    // guard re-arms on userId change.
    await waitFor(() => {
      expect(getDashboardSpy.mock.calls.length).toBeGreaterThan(
        callsAfterUser1,
      );
    });
  });
});
