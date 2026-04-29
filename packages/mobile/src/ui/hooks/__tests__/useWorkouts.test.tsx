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
    onAuthStateChange: jest.fn((cb: (s: AuthSession | null) => void) => {
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

    // Wait for the auth-bootstrap setTimeout to fire so the userId is set
    // and the hook has run at least once with a valid session.
    await waitFor(() => {
      // After auth bootstrap, refresh() returns a Promise rather than undefined
      const r = result.current.refresh();
      expect(r).toBeDefined();
      return r;
    });

    await act(async () => {
      await result.current.refresh();
    });

    await waitFor(() => {
      expect(result.current.mine.workouts[0]?.name).toBe("API");
    });
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
});
