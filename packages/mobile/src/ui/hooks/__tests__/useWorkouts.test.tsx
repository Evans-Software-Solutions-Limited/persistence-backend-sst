import { renderHook, waitFor, act } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { AuthSession } from "@/domain/ports/auth.port";
import type { Workout } from "@/domain/models/workout";
import { ok } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import { useWorkouts } from "@/ui/hooks/useWorkouts";

const mockFetch = jest.fn();
(globalThis as Record<string, unknown>).fetch = mockFetch;

jest.mock("@/adapters/api", () => ({
  ...jest.requireActual("@/adapters/api"),
  getApiBaseUrl: () => "https://api.test",
}));

const buildWorkout = (overrides: Partial<Workout> = {}): Workout => ({
  id: overrides.id ?? "w-1",
  name: overrides.name ?? "Push",
  description: null,
  createdBy: overrides.createdBy ?? "test-user",
  visibility: overrides.visibility ?? "private",
  estimatedDurationMinutes: 45,
  exercises: overrides.exercises ?? [],
  createdAt: "2026-04-28T00:00:00Z",
  updatedAt: "2026-04-28T00:00:00Z",
  ...overrides,
});

function makeAdapters(
  api: InMemoryApiAdapter,
  storage: InMemoryStorageAdapter,
): Adapters {
  const session: AuthSession = {
    accessToken: "t",
    refreshToken: "r",
    userId: "test-user",
    email: "u@example.com",
    expiresAt: Date.now() + 60_000,
  };
  const auth = {
    signInWithEmail: jest.fn(),
    signUpWithEmail: jest.fn(),
    signInWithOAuth: jest.fn(),
    signOut: jest.fn(),
    getSession: jest.fn(async () => ok(session)),
    // Fire the auth-state callback synchronously at registration
    // time. The legacy mock deferred this via `setTimeout(... , 0)`
    // to mimic Supabase's INITIAL_SESSION event, but the resulting
    // unwrapped `setSession` setState (fired from a macrotask) raced
    // with `waitFor` polling under CI load and intermittently caused
    // `refresh()` to fire before `userId` had settled — the cached
    // call signature returned undefined instead of the post-refresh
    // workout list. Synchronous firing collapses the bootstrap into
    // a single render commit and removes the race.
    onAuthStateChange: jest.fn((cb: (s: AuthSession | null) => void) => {
      cb(session);
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
    health: {} as Adapters["health"],
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

describe("useWorkouts", () => {
  it("renders empty/stale state then auto-refreshes when cache is empty", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    api.workouts.push(buildWorkout({ id: "w-fresh" }));
    api.workoutQuota = { used: 1, limit: 50 };
    const adapters = makeAdapters(api, storage);

    const { result } = renderHook(() => useWorkouts(), {
      wrapper: wrap(adapters),
    });

    expect(result.current.mine.workouts).toEqual([]);
    expect(result.current.mine.isStale).toBe(true);

    await waitFor(() => {
      expect(result.current.mine.workouts).toHaveLength(1);
    });
    expect(result.current.mine.workouts[0].id).toBe("w-fresh");
    expect(result.current.mine.quota).toEqual({ used: 1, limit: 50 });
    expect(result.current.error).toBeNull();
  });

  it("renders cached state on mount and skips auto-refresh when fresh", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    storage.cacheWorkoutsList(
      "test-user",
      "mine",
      [buildWorkout({ id: "w-cached", name: "Cached" })],
      { used: 1, limit: 10 },
    );
    storage.cacheWorkoutsList("test-user", "assigned", [], null);
    storage.cacheWorkoutsList("test-user", "default", [], null);

    const adapters = makeAdapters(api, storage);

    const { result } = renderHook(() => useWorkouts(), {
      wrapper: wrap(adapters),
    });

    // Auth bootstrap fires via setTimeout(0); wait for the userId to settle
    // and the cache read to populate.
    await waitFor(() => {
      expect(result.current.mine.workouts[0]?.name).toBe("Cached");
    });
    expect(result.current.mine.quota).toEqual({ used: 1, limit: 10 });
    expect(result.current.mine.isStale).toBe(false);
  });

  it("refresh() updates the snapshot from the api", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    storage.cacheWorkoutsList("test-user", "mine", [], null);
    storage.cacheWorkoutsList("test-user", "assigned", [], null);
    storage.cacheWorkoutsList("test-user", "default", [], null);

    api.workouts.push(buildWorkout({ id: "w-from-api", name: "API" }));

    const adapters = makeAdapters(api, storage);
    const { result } = renderHook(() => useWorkouts(), {
      wrapper: wrap(adapters),
    });

    // Wait for the auth bootstrap to fire so `userId` is set and the
    // hook is past its early-return path (refresh() is a no-op until
    // a session is available). Bumped from the default 1 s to 5 s
    // because GHA-runner load occasionally pushes the synchronous
    // auth bootstrap + initial render commit past the 1 s budget —
    // PR-3 CI flake.
    await waitFor(
      () => {
        const r = result.current.refresh();
        expect(r).toBeDefined();
        return r;
      },
      { timeout: 5000 },
    );

    await act(async () => {
      await result.current.refresh();
    });

    // Same rationale on the data-arrival assertion — give the
    // post-refresh re-render a generous budget so a slow CI tick
    // can't intermittently fail the test before state lands.
    await waitFor(
      () => {
        expect(result.current.mine.workouts[0]?.name).toBe("API");
      },
      { timeout: 5000 },
    );
  });

  it("dedupes concurrent refresh() calls onto a single in-flight promise per user", async () => {
    // Slow-down the in-memory API so that two refresh() calls overlap
    // and the second one hits the inFlightRef early-return branch.
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    storage.cacheWorkoutsList("test-user", "mine", [], null);
    storage.cacheWorkoutsList("test-user", "assigned", [], null);
    storage.cacheWorkoutsList("test-user", "default", [], null);

    const originalGetWorkouts = api.getWorkouts.bind(api);
    const getWorkoutsSpy = jest
      .spyOn(api, "getWorkouts")
      .mockImplementation(async (...args) => {
        // Yield a microtask so the second refresh() can register before
        // the first resolves.
        await new Promise<void>((resolve) => setTimeout(resolve, 10));
        return originalGetWorkouts(...args);
      });

    const adapters = makeAdapters(api, storage);
    const { result } = renderHook(() => useWorkouts(), {
      wrapper: wrap(adapters),
    });

    // Wait for auth bootstrap so userId is set.
    await waitFor(() => {
      expect(result.current.refresh).toBeDefined();
    });

    await act(async () => {
      const a = result.current.refresh();
      const b = result.current.refresh();
      await Promise.all([a, b]);
    });

    // Both calls should share one round-trip — getWorkouts fires three
    // times (one per section) for the FIRST refresh, plus zero for the
    // second (deduped).
    expect(getWorkoutsSpy).toHaveBeenCalledTimes(3);
  });

  it("surfaces an api error without clobbering cached payload", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    storage.cacheWorkoutsList(
      "test-user",
      "mine",
      [buildWorkout({ id: "w-cached" })],
      null,
    );
    storage.cacheWorkoutsList("test-user", "assigned", [], null);
    storage.cacheWorkoutsList("test-user", "default", [], null);
    api.shouldFail = true;

    const adapters = makeAdapters(api, storage);
    const { result } = renderHook(() => useWorkouts(), {
      wrapper: wrap(adapters),
    });

    // Auth bootstrap completes, then trigger refresh. Use waitFor to wait
    // for both the userId to be ready and the error to surface.
    await waitFor(() => {
      void result.current.refresh();
      expect(result.current.error).not.toBeNull();
    });

    // Cached workout still visible
    expect(result.current.mine.workouts[0].id).toBe("w-cached");
  });

  it("flushes the sync queue before fetching during refresh()", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    storage.cacheWorkoutsList(
      "test-user",
      "mine",
      [buildWorkout({ id: "w-old" })],
      null,
    );
    storage.cacheWorkoutsList("test-user", "assigned", [], null);
    storage.cacheWorkoutsList("test-user", "default", [], null);
    storage.enqueueMutation({
      entityType: "workout",
      entityId: "local-1",
      operation: "create",
      payload: { name: "Push Day" },
      endpoint: "/workouts",
      method: "POST",
    });

    const callOrder: string[] = [];
    mockFetch.mockReset();
    mockFetch.mockImplementation((url: string) => {
      callOrder.push(`fetch ${url}`);
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
    const getSpy = jest
      .spyOn(api, "getWorkouts")
      .mockImplementation(async (params) => {
        callOrder.push(`getWorkouts ${params?.type ?? "all"}`);
        return ok({ workouts: [], total: 0, quota: null });
      });

    const adapters = makeAdapters(api, storage);
    const { result } = renderHook(() => useWorkouts(), {
      wrapper: wrap(adapters),
    });

    // Wait for auth bootstrap.
    await waitFor(() =>
      expect(result.current.mine.workouts[0]?.id).toBe("w-old"),
    );

    callOrder.length = 0;
    mockFetch.mockClear();
    getSpy.mockClear();

    await act(async () => {
      await result.current.refresh();
    });

    // Sync queue's POST went out before any GET /workouts call.
    expect(callOrder[0]).toBe("fetch https://api.test/workouts");
    expect(callOrder.slice(1).every((c) => c.startsWith("getWorkouts"))).toBe(
      true,
    );
  });

  it("rereadCache picks up an external storage write without hitting the API", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    // Seed cache so the on-mount auto-refresh doesn't fire.
    storage.cacheWorkoutsList(
      "test-user",
      "mine",
      [buildWorkout({ id: "w-old", name: "Old" })],
      null,
    );
    storage.cacheWorkoutsList("test-user", "assigned", [], null);
    storage.cacheWorkoutsList("test-user", "default", [], null);
    const getSpy = jest.spyOn(api, "getWorkouts");

    const adapters = makeAdapters(api, storage);
    const { result } = renderHook(() => useWorkouts(), {
      wrapper: wrap(adapters),
    });

    await waitFor(() =>
      expect(result.current.mine.workouts[0]?.id).toBe("w-old"),
    );

    // Simulate an external mutation (the creator command writing to
    // SQLite from inside the modal stack).
    storage.cacheWorkoutsList(
      "test-user",
      "mine",
      [
        buildWorkout({ id: "w-new", name: "New" }),
        buildWorkout({ id: "w-old", name: "Old" }),
      ],
      null,
    );

    // Hook hasn't picked it up yet — no signal to re-read.
    expect(result.current.mine.workouts.map((w) => w.id)).toEqual(["w-old"]);

    act(() => {
      result.current.rereadCache();
    });

    await waitFor(() =>
      expect(result.current.mine.workouts.map((w) => w.id)).toEqual([
        "w-new",
        "w-old",
      ]),
    );
    // No API call fired — soft re-read should never hit the network.
    expect(getSpy).not.toHaveBeenCalled();
  });
});
