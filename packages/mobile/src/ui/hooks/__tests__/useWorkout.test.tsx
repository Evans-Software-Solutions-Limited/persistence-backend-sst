import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { AuthSession } from "@/domain/ports/auth.port";
import type { Workout } from "@/domain/models/workout";
import { ok } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import { useWorkout } from "@/ui/hooks/useWorkout";

const buildWorkout = (overrides: Partial<Workout> = {}): Workout => ({
  id: overrides.id ?? "w-1",
  name: overrides.name ?? "Push Day",
  description: null,
  createdBy: "user-1",
  visibility: "private",
  estimatedDurationMinutes: 45,
  exercises: [],
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
    userId: "user-1",
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
  return function Wrapper({ children }: { children: ReactNode }) {
    return <AdapterProvider adapters={adapters}>{children}</AdapterProvider>;
  };
}

describe("useWorkout", () => {
  it("returns EMPTY when workoutId is null", () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    const { result } = renderHook(() => useWorkout(null), {
      wrapper: wrap(makeAdapters(api, storage)),
    });
    expect(result.current.workout).toBeNull();
    expect(result.current.isStale).toBe(true);
  });

  it("renders cache-first when present, then auto-refreshes when stale", async () => {
    const api = new InMemoryApiAdapter();
    const cached = buildWorkout({ id: "w-1", name: "Cached" });
    const fresh = buildWorkout({ id: "w-1", name: "Fresh" });
    const getSpy = jest.spyOn(api, "getWorkout").mockResolvedValue(ok(fresh));

    const storage = new InMemoryStorageAdapter();
    storage.cacheWorkoutDetail("user-1", cached);

    const { result } = renderHook(() => useWorkout("w-1"), {
      wrapper: wrap(makeAdapters(api, storage)),
    });
    // The seed cache is fresh from cacheWorkoutDetail using new Date(),
    // so isStale starts false. We assert the initial cache hit.
    await waitFor(() => expect(result.current.workout?.name).toBe("Cached"));

    // Force a manual refresh and verify the fetched value lands.
    await act(async () => {
      await result.current.refresh();
    });
    expect(getSpy).toHaveBeenCalledWith("w-1");
    expect(result.current.workout?.name).toBe("Fresh");
  });

  it("auto-fetches when no cached row exists", async () => {
    const api = new InMemoryApiAdapter();
    const fresh = buildWorkout({ id: "w-1" });
    const getSpy = jest.spyOn(api, "getWorkout").mockResolvedValue(ok(fresh));
    const storage = new InMemoryStorageAdapter();

    const { result } = renderHook(() => useWorkout("w-1"), {
      wrapper: wrap(makeAdapters(api, storage)),
    });
    await waitFor(() => expect(getSpy).toHaveBeenCalled());
    await waitFor(() => expect(result.current.workout?.id).toBe("w-1"));
  });

  it("dedupes concurrent refreshes for the same workout", async () => {
    const api = new InMemoryApiAdapter();
    let resolveCount = 0;
    const getSpy = jest.spyOn(api, "getWorkout").mockImplementation(
      async () =>
        new Promise((resolve) => {
          resolveCount++;
          setTimeout(() => resolve(ok(buildWorkout({ id: "w-1" }))), 10);
        }),
    );
    const storage = new InMemoryStorageAdapter();
    storage.cacheWorkoutDetail("user-1", buildWorkout({ id: "w-1" }));

    const { result } = renderHook(() => useWorkout("w-1"), {
      wrapper: wrap(makeAdapters(api, storage)),
    });

    // Wait for the auth bootstrap to land — until then `userId` is null
    // and `refresh` is the EMPTY no-op.
    await waitFor(() => expect(result.current.workout?.id).toBe("w-1"));

    await act(async () => {
      const a = result.current.refresh();
      const b = result.current.refresh();
      await Promise.all([a, b]);
    });
    // Exactly one underlying fetch.
    expect(getSpy).toHaveBeenCalledTimes(1);
    expect(resolveCount).toBe(1);
  });
});
