import { renderHook, act, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { AuthSession } from "@/domain/ports/auth.port";
import type { ApiPort } from "@/domain/ports/api.port";
import type { StoragePort } from "@/domain/ports/storage.port";
import { ok, fail, type Result, type ApiError } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import {
  useCachedResource,
  type CachedResourceConfig,
} from "@/ui/hooks/useCachedResource";

// The sync queue drain hits the network; a no-op fetch keeps `refresh` from
// throwing when a test happens to trigger it. None of the reload assertions
// depend on it resolving.
const mockFetch = jest.fn(async (..._args: unknown[]) => ({
  ok: true,
  status: 200,
  headers: { get: () => null },
  json: async () => ({ data: {} }),
}));
(globalThis as Record<string, unknown>).fetch = mockFetch;

jest.mock("@/adapters/api", () => ({
  ...jest.requireActual("@/adapters/api"),
  getApiBaseUrl: () => "https://api.test",
}));

const USER = "user-1";

function makeAdapters(
  api: InMemoryApiAdapter,
  storage: InMemoryStorageAdapter,
  signedIn = true,
): Adapters {
  const session: AuthSession = {
    accessToken: "t",
    refreshToken: "r",
    userId: USER,
    email: "u@example.com",
    expiresAt: Date.now() + 60_000,
  };
  const auth = {
    getSession: jest.fn(async () => ok(signedIn ? session : null)),
    onAuthStateChange: jest.fn((cb: (s: AuthSession | null) => void) => {
      cb(signedIn ? session : null);
      return () => {};
    }),
    getAccessToken: jest.fn(async () => (signedIn ? "t" : null)),
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

/**
 * A tiny cached-resource config backed by a single StoragePort slot. `read`
 * pulls the current cached string; `write` stores it. The completions cache is
 * a convenient real slot on the in-memory adapter — we treat its first row's
 * `value` as our scalar so we exercise a genuine StoragePort round-trip rather
 * than a bespoke Map. `isStale: false` so the hook does NOT auto-refresh on
 * mount (this test is about `reload`, not the network path).
 */
function scalarConfig(
  fetcher: (api: ApiPort) => Promise<Result<number, ApiError>>,
): CachedResourceConfig<number> {
  return {
    read: (storage: StoragePort, userId: string) => {
      const rows = storage.getCachedHabitCompletions(userId, {
        goalId: "cell",
      });
      return { value: rows[0]?.value ?? null, isStale: false };
    },
    fetcher,
    write: (storage: StoragePort, userId: string, value: number) =>
      storage.cacheHabitCompletions(userId, [
        {
          id: "cell",
          userId,
          goalId: "cell",
          completedAt: "2026-06-01T12:00:00.000Z",
          localCompletedDate: "2026-06-01",
          value,
        },
      ]),
  };
}

/** Directly overwrite the cache slot `scalarConfig.read` observes. */
function writeCache(storage: InMemoryStorageAdapter, value: number): void {
  storage.cacheHabitCompletions(USER, [
    {
      id: "cell",
      userId: USER,
      goalId: "cell",
      completedAt: "2026-06-01T12:00:00.000Z",
      localCompletedDate: "2026-06-01",
      value,
    },
  ]);
}

beforeEach(() => mockFetch.mockClear());

describe("useCachedResource — reload() reactive bridge (regression)", () => {
  it("reload() reflects an out-of-band cache write into data synchronously, with NO network fetch", () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    // Seed the cache before mount so `read` picks it up on the first render.
    writeCache(storage, 1);

    // A fetcher that NEVER resolves: if `reload` depended on the network to
    // apply, this test would hang / never flip. It stays pending the whole
    // test, proving reload is a pure synchronous cache re-read.
    const fetcher = jest.fn(
      () => new Promise<Result<number, ApiError>>(() => {}),
    );

    const { result } = renderHook(
      () => useCachedResource(scalarConfig(fetcher)),
      {
        wrapper: wrap(makeAdapters(api, storage)),
      },
    );

    // Mount snapshot reflects the seeded cache.
    expect(result.current.data).toBe(1);

    // Out-of-band write — the classic optimistic-mutation shape: a command
    // wrote the cache directly and returned void. Before `reload`, the MOUNTED
    // hook's `data` snapshot is still the old value (the frozen-grid bug).
    act(() => writeCache(storage, 2));
    expect(result.current.data).toBe(1);

    // reload() re-reads the cache and pushes it into local state — the flip
    // that proves a mounted component re-renders without a re-mount.
    act(() => result.current.reload());
    expect(result.current.data).toBe(2);

    // isStale:false config + never-resolving fetcher ⇒ no auto-refresh fired,
    // and reload itself hit neither the fetcher nor the network.
    expect(fetcher).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("reload() is a no-op when there is no signed-in user", () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    // A cache row exists under USER, but the session is signed OUT, so the
    // hook has no userId to read against.
    writeCache(storage, 9);
    const fetcher = jest.fn(async () => ok(0));

    const { result } = renderHook(
      () => useCachedResource(scalarConfig(fetcher)),
      {
        wrapper: wrap(makeAdapters(api, storage, false)),
      },
    );

    // No user → mount reads nothing.
    expect(result.current.data).toBeNull();

    // reload must early-return (guarding the null userId) rather than reading
    // some other user's cache or throwing.
    act(() => result.current.reload());
    expect(result.current.data).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("refresh() still reconciles with server truth (reload does not replace it)", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    writeCache(storage, 1);
    const fetcher = jest.fn(async () => ok(42));

    const { result } = renderHook(
      () => useCachedResource(scalarConfig(fetcher)),
      {
        wrapper: wrap(makeAdapters(api, storage)),
      },
    );
    expect(result.current.data).toBe(1);

    await act(async () => {
      await result.current.refresh();
    });
    // The network value wins and is written through to the cache.
    await waitFor(() => expect(result.current.data).toBe(42));
    expect(fetcher).toHaveBeenCalled();
    expect(
      storage.getCachedHabitCompletions(USER, { goalId: "cell" })[0].value,
    ).toBe(42);
  });
});

/**
 * A cold-start config: stale + reads the same scalar slot as `scalarConfig`, so
 * an empty cache means `value: null` (the new-account / new-device case) and the
 * hook fires its auto-refresh on mount.
 */
function staleConfig(
  fetcher: (api: ApiPort) => Promise<Result<number, ApiError>>,
): CachedResourceConfig<number> {
  return {
    ...scalarConfig(fetcher),
    read: (storage, userId) => ({
      value:
        storage.getCachedHabitCompletions(userId, { goalId: "cell" })[0]
          ?.value ?? null,
      isStale: true,
    }),
  };
}

const apiTimeout: ApiError = {
  kind: "api",
  code: "timeout",
  message: "Request timed out",
};

describe("useCachedResource — cold-start retry", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("retries a transient failure on an empty cache and succeeds on a later attempt", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    // Empty cache → cold start. First attempt times out (cold Lambda); the
    // retry succeeds once the backend has warmed.
    const fetcher = jest
      .fn<Promise<Result<number, ApiError>>, [ApiPort]>()
      .mockResolvedValueOnce(fail(apiTimeout))
      .mockResolvedValueOnce(ok(7));

    const { result } = renderHook(
      () => useCachedResource(staleConfig(fetcher)),
      {
        wrapper: wrap(makeAdapters(api, storage)),
      },
    );

    await act(async () => {
      await jest.advanceTimersByTimeAsync(2000); // past the 1500ms 2nd-attempt delay
    });

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result.current.data).toBe(7);
    expect(result.current.error).toBeNull();
  });

  it("surfaces the error only after exhausting the retry budget", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    const fetcher = jest
      .fn<Promise<Result<number, ApiError>>, [ApiPort]>()
      .mockResolvedValue(fail(apiTimeout));

    const { result } = renderHook(
      () => useCachedResource(staleConfig(fetcher)),
      {
        wrapper: wrap(makeAdapters(api, storage)),
      },
    );

    await act(async () => {
      await jest.advanceTimersByTimeAsync(6000); // 0 + 1500 + 4000 = all attempts
    });

    // Three attempts (COLD_START_RETRY_DELAYS_MS.length), then the error sticks.
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toEqual(apiTimeout);
  });

  it("does NOT retry a non-transient (4xx) failure", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    const unauthorized: ApiError = {
      kind: "api",
      code: "unauthorized",
      message: "Unauthorized",
    };
    const fetcher = jest
      .fn<Promise<Result<number, ApiError>>, [ApiPort]>()
      .mockResolvedValue(fail(unauthorized));

    const { result } = renderHook(
      () => useCachedResource(staleConfig(fetcher)),
      {
        wrapper: wrap(makeAdapters(api, storage)),
      },
    );

    await act(async () => {
      await jest.advanceTimersByTimeAsync(6000);
    });

    // A 4xx won't self-heal — surface it immediately, no retries.
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.current.error).toEqual(unauthorized);
  });

  it("cancels the retry loop on unmount (no further attempts after unmount)", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    const fetcher = jest
      .fn<Promise<Result<number, ApiError>>, [ApiPort]>()
      .mockResolvedValue(fail(apiTimeout));

    const { unmount } = renderHook(
      () => useCachedResource(staleConfig(fetcher)),
      { wrapper: wrap(makeAdapters(api, storage)) },
    );

    // Attempt 1 (delay 0) fires and fails; unmount while awaiting the 1500ms
    // backoff before attempt 2.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(100);
    });
    const callsAtUnmount = fetcher.mock.calls.length;
    unmount();

    // Drain every remaining timer — the loop must see `cancelled` and stop.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(6000);
    });
    expect(fetcher.mock.calls.length).toBe(callsAtUnmount);
  });

  it("logs and still fetches when the pre-fetch queue drain throws", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    // A queue-drain failure must not abort the fetch — the GET still runs.
    jest.spyOn(storage, "getPendingMutations").mockImplementation(() => {
      throw new Error("queue read failed");
    });
    const errSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const fetcher = jest
      .fn<Promise<Result<number, ApiError>>, [ApiPort]>()
      .mockResolvedValue(ok(3));

    const { result } = renderHook(
      () => useCachedResource(staleConfig(fetcher)),
      {
        wrapper: wrap(makeAdapters(api, storage)),
      },
    );

    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
    });

    expect(result.current.data).toBe(3);
    expect(errSpy).toHaveBeenCalledWith(
      "[useCachedResource] queue flush failed:",
      expect.any(Error),
    );
    errSpy.mockRestore();
  });

  it("does NOT retry when a stale cache is already present (single attempt)", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    // Stale-but-present cache: the stale value renders, so a failed refresh is
    // invisible and must not trigger the cold-start retry loop.
    writeCache(storage, 5);
    const fetcher = jest
      .fn<Promise<Result<number, ApiError>>, [ApiPort]>()
      .mockResolvedValue(fail(apiTimeout));

    const { result } = renderHook(
      () => useCachedResource(staleConfig(fetcher)),
      {
        wrapper: wrap(makeAdapters(api, storage)),
      },
    );

    await act(async () => {
      await jest.advanceTimersByTimeAsync(6000);
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.current.data).toBe(5); // stale cache still shown
  });
});
