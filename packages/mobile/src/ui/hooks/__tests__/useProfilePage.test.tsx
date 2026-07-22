import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { PROFILE_PAGE_FIXTURE } from "@/adapters/api/__tests__/fixtures/profile-page.fixture";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { AuthSession } from "@/domain/ports/auth.port";
import { ok } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import { useProfilePage } from "@/ui/hooks/useProfilePage";

function makeAdapters(
  api: InMemoryApiAdapter,
  storage: InMemoryStorageAdapter,
  userId: string | null = "user-1",
): Adapters {
  const session: AuthSession | null = userId
    ? {
        accessToken: "t",
        refreshToken: "r",
        userId,
        email: "u@example.com",
        expiresAt: Date.now() + 60_000,
      }
    : null;
  const auth = {
    signInWithEmail: jest.fn(),
    signUpWithEmail: jest.fn(),
    signInWithOAuth: jest.fn(),
    signOut: jest.fn(),
    getSession: jest.fn(async () => ok(session)),
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
    netInfo: {} as Adapters["netInfo"],
  };
}

/**
 * Adapters whose auth session can be swapped at runtime, so a test can drive a
 * logout→login (user A → user B) and assert the auto-fetch re-arms. Captures
 * the `onAuthStateChange` callback `useAuth` subscribes with and returns an
 * `emit(userId)` to push a new session (or `null` to sign out).
 */
function makeSwitchableAdapters(
  api: InMemoryApiAdapter,
  storage: InMemoryStorageAdapter,
  initialUserId: string,
): { adapters: Adapters; emit: (userId: string | null) => void } {
  const sessionFor = (userId: string | null): AuthSession | null =>
    userId
      ? {
          accessToken: "t",
          refreshToken: "r",
          userId,
          email: `${userId}@example.com`,
          expiresAt: Date.now() + 60_000,
        }
      : null;
  let listener: ((s: AuthSession | null) => void) | null = null;
  const auth = {
    signInWithEmail: jest.fn(),
    signUpWithEmail: jest.fn(),
    signInWithOAuth: jest.fn(),
    signOut: jest.fn(),
    getSession: jest.fn(async () => ok(sessionFor(initialUserId))),
    onAuthStateChange: jest.fn((cb: (s: AuthSession | null) => void) => {
      listener = cb;
      return () => {};
    }),
    resetPassword: jest.fn(),
    refreshSession: jest.fn(),
    getAccessToken: jest.fn(async () => "t"),
  } as unknown as Adapters["auth"];
  return {
    adapters: {
      api,
      auth,
      storage,
      health: {} as Adapters["health"],
      notifications: {} as Adapters["notifications"],
      payments: {} as Adapters["payments"],
      netInfo: {} as Adapters["netInfo"],
    },
    emit: (userId) => listener?.(sessionFor(userId)),
  };
}

function wrap(adapters: Adapters) {
  function Wrapper({ children }: { children: ReactNode }) {
    return <AdapterProvider adapters={adapters}>{children}</AdapterProvider>;
  }
  return Wrapper;
}

describe("useProfilePage", () => {
  it("renders null + auto-refreshes when cache is empty", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    api.profilePage = PROFILE_PAGE_FIXTURE;
    const adapters = makeAdapters(api, storage);

    const { result } = renderHook(() => useProfilePage(), {
      wrapper: wrap(adapters),
    });

    expect(result.current.payload).toBeNull();
    expect(result.current.isStale).toBe(true);

    await waitFor(() => {
      expect(result.current.payload).toEqual(PROFILE_PAGE_FIXTURE);
    });
    expect(result.current.isStale).toBe(false);
    expect(result.current.syncedAt).not.toBeNull();
  });

  it("exposes cached payload on mount when already fresh", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    storage.cacheProfilePage("user-1", PROFILE_PAGE_FIXTURE);
    api.profilePage = PROFILE_PAGE_FIXTURE;
    const adapters = makeAdapters(api, storage);

    const { result } = renderHook(() => useProfilePage(), {
      wrapper: wrap(adapters),
    });
    await waitFor(() => {
      expect(result.current.payload).not.toBeNull();
    });
    expect(result.current.isStale).toBe(false);
  });

  it("surfaces an ApiError when refresh fails", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    api.profilePage = PROFILE_PAGE_FIXTURE;
    api.shouldFail = true;
    api.failError = { kind: "api", code: "server", message: "boom" };
    const adapters = makeAdapters(api, storage);

    const { result } = renderHook(() => useProfilePage(), {
      wrapper: wrap(adapters),
    });

    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });
    expect(result.current.error?.message).toBe("boom");
    // Cache untouched on failure.
    expect(storage.getCachedProfilePage("user-1")).toBeNull();
  });

  it("retries a failed auto-fetch with backoff and recovers (QA-9)", async () => {
    jest.useFakeTimers();
    try {
      const api = new InMemoryApiAdapter();
      const storage = new InMemoryStorageAdapter();
      api.profilePage = PROFILE_PAGE_FIXTURE;
      api.shouldFail = true; // first attempt fails
      const adapters = makeAdapters(api, storage);

      const { result } = renderHook(() => useProfilePage(), {
        wrapper: wrap(adapters),
      });

      // Initial auto-fetch fires and fails, leaving an error + empty payload.
      // The retry is still pending, so `isAutoRetrying` holds true through the
      // backoff gap (this is what keeps the UI on its loader, not the error).
      await act(async () => {});
      expect(api.getProfilePageCalls).toBe(1);
      expect(result.current.error).not.toBeNull();
      expect(result.current.payload).toBeNull();
      expect(result.current.isAutoRetrying).toBe(true);

      // Backend recovers; the backoff timer (2s) fires the retry.
      api.shouldFail = false;
      await act(async () => {
        await jest.advanceTimersByTimeAsync(2000);
      });

      expect(api.getProfilePageCalls).toBe(2);
      expect(result.current.payload).toEqual(PROFILE_PAGE_FIXTURE);
      expect(result.current.error).toBeNull();
      expect(result.current.isAutoRetrying).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  it("gives up after the bounded number of attempts (QA-9)", async () => {
    jest.useFakeTimers();
    try {
      const api = new InMemoryApiAdapter();
      const storage = new InMemoryStorageAdapter();
      api.profilePage = PROFILE_PAGE_FIXTURE;
      api.shouldFail = true; // never recovers
      const adapters = makeAdapters(api, storage);

      const { result } = renderHook(() => useProfilePage(), {
        wrapper: wrap(adapters),
      });

      await act(async () => {}); // attempt 1
      expect(api.getProfilePageCalls).toBe(1);
      expect(result.current.isAutoRetrying).toBe(true);

      await act(async () => {
        await jest.advanceTimersByTimeAsync(2000); // attempt 2 (backoff 2s)
      });
      expect(api.getProfilePageCalls).toBe(2);
      expect(result.current.isAutoRetrying).toBe(true);

      await act(async () => {
        await jest.advanceTimersByTimeAsync(4000); // attempt 3 (backoff 4s)
      });
      expect(api.getProfilePageCalls).toBe(3);

      // Exhausted — no further retry is scheduled however long we wait, and
      // auto-retrying drops so the UI can show its error surface.
      await act(async () => {
        await jest.advanceTimersByTimeAsync(60_000);
      });
      expect(api.getProfilePageCalls).toBe(3);
      expect(result.current.error).not.toBeNull();
      expect(result.current.payload).toBeNull();
      expect(result.current.isAutoRetrying).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  it("clears a pending retry on unmount (QA-9)", async () => {
    jest.useFakeTimers();
    try {
      const api = new InMemoryApiAdapter();
      const storage = new InMemoryStorageAdapter();
      api.profilePage = PROFILE_PAGE_FIXTURE;
      api.shouldFail = true;
      const adapters = makeAdapters(api, storage);

      const { unmount } = renderHook(() => useProfilePage(), {
        wrapper: wrap(adapters),
      });

      await act(async () => {}); // attempt 1 fails, retry scheduled
      expect(api.getProfilePageCalls).toBe(1);

      unmount();
      await act(async () => {
        await jest.advanceTimersByTimeAsync(10_000);
      });
      // The scheduled retry was cleared on unmount — no orphaned fetch.
      expect(api.getProfilePageCalls).toBe(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it("re-arms the auto-fetch when the user changes (logout→login) — QA-9", async () => {
    jest.useFakeTimers();
    try {
      const api = new InMemoryApiAdapter();
      const storage = new InMemoryStorageAdapter();
      api.profilePage = PROFILE_PAGE_FIXTURE;
      api.shouldFail = true; // user A's fetches fail (the stranded-loader setup)
      const { adapters, emit } = makeSwitchableAdapters(api, storage, "user-A");

      const { result } = renderHook(() => useProfilePage(), {
        wrapper: wrap(adapters),
      });

      // User A: the auto-fetch fires and fails; a retry is pending.
      await act(async () => {});
      const callsForA = api.getProfilePageCalls;
      expect(callsForA).toBeGreaterThanOrEqual(1);
      expect(result.current.payload).toBeNull();
      expect(result.current.isAutoRetrying).toBe(true);

      // Sign in as a different user with a healthy backend. The old one-shot
      // latch never re-fired; the fix must arm a fresh fetch for user B.
      api.shouldFail = false;
      await act(async () => {
        emit("user-B");
      });
      await act(async () => {});

      expect(api.getProfilePageCalls).toBeGreaterThan(callsForA);
      expect(result.current.payload).toEqual(PROFILE_PAGE_FIXTURE);
      expect(result.current.error).toBeNull();
      expect(result.current.isAutoRetrying).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  it("does not auto-fetch when there is no authenticated user", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    api.profilePage = PROFILE_PAGE_FIXTURE;
    const adapters = makeAdapters(api, storage, null);

    const { result } = renderHook(() => useProfilePage(), {
      wrapper: wrap(adapters),
    });

    await act(async () => {});
    expect(api.getProfilePageCalls).toBe(0);
    expect(result.current.payload).toBeNull();
  });

  it("dedupes concurrent same-user refresh() calls", async () => {
    const api = new InMemoryApiAdapter();
    api.profilePage = PROFILE_PAGE_FIXTURE;
    const storage = new InMemoryStorageAdapter();
    storage.cacheProfilePage("user-1", PROFILE_PAGE_FIXTURE);
    const adapters = makeAdapters(api, storage);
    const spy = jest.spyOn(api, "getProfilePage");

    const { result } = renderHook(() => useProfilePage(), {
      wrapper: wrap(adapters),
    });
    await waitFor(() => {
      expect(result.current.payload).not.toBeNull();
    });
    spy.mockClear();

    await act(async () => {
      await Promise.all([
        result.current.refresh(),
        result.current.refresh(),
        result.current.refresh(),
      ]);
    });

    expect(spy).toHaveBeenCalledTimes(1);
  });
});
