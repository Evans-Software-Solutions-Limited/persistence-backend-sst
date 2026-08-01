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

  it("refresh({ silent: true }) updates data WITHOUT toggling isRefreshing", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    writeCache(storage, 1);
    // Gate the fetch so we can observe isRefreshing WHILE it's in flight.
    let release: (() => void) | null = null;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const fetcher = jest.fn(async () => {
      await gate;
      return ok(99);
    });

    const { result } = renderHook(
      () => useCachedResource(scalarConfig(fetcher)),
      { wrapper: wrap(makeAdapters(api, storage)) },
    );
    expect(result.current.data).toBe(1);

    let done: Promise<void>;
    act(() => {
      done = result.current.refresh({ silent: true });
    });
    // A silent refresh must NOT flip the RefreshControl-bound flag, even while
    // the fetch is in flight (this is what keeps a focus refresh spinner-free).
    expect(result.current.isRefreshing).toBe(false);

    await act(async () => {
      release?.();
      await done;
    });
    await waitFor(() => expect(result.current.data).toBe(99));
    expect(result.current.isRefreshing).toBe(false);
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

  it("releases inFlightRef when the mount auto-refresh's fetcher THROWS, so a later refresh() isn't a permanent no-op (QA-14a regression)", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    // The fetcher REJECTS (throws) instead of resolving a Result — this is
    // the shape that used to skip the `inFlightRef.current = false` /
    // `setIsRefreshing(false)` resets entirely (they lived at the end of the
    // IIFE with no try/finally), stranding `inFlightRef` at `true` forever.
    const errSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const fetcher = jest
      .fn<Promise<Result<number, ApiError>>, [ApiPort]>()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(ok(9));

    const { result } = renderHook(
      () => useCachedResource(staleConfig(fetcher)),
      {
        wrapper: wrap(makeAdapters(api, storage)),
      },
    );

    // Mount auto-refresh fires (delay 0), throws once, and the IIFE's
    // finally must still release inFlightRef/isRefreshing.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.current.isRefreshing).toBe(false);

    // The regression: without the fix, inFlightRef stays true forever, so
    // this refresh() early-returns and the fetcher is never called again.
    await act(async () => {
      await result.current.refresh();
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result.current.data).toBe(9);
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

describe("useCachedResource — bus-driven reload must not blank the screen", () => {
  /**
   * Same scalar slot, but declaring `tables` so the change bus drives re-reads.
   * `cached_habit_completions` stands in for `cached_home`: what matters is that
   * the slot can be DELETED, which is how `invalidateHome`/`invalidateDashboard`/
   * `invalidateGoals` all work.
   */
  function subscribedConfig(): CachedResourceConfig<number> {
    return { ...scalarConfig(async () => ok(99)), tables: ["cell_table"] };
  }

  it("adopts a real value written by someone else", () => {
    const storage = new InMemoryStorageAdapter();
    storage.initialize();
    writeCache(storage, 1);
    const adapters = makeAdapters(new InMemoryApiAdapter(), storage);

    const { result } = renderHook(() => useCachedResource(subscribedConfig()), {
      wrapper: wrap(adapters),
    });
    expect(result.current.data).toBe(1);

    writeCache(storage, 7);
    act(() => storage.emitChange("cell_table"));

    expect(result.current.data).toBe(7);
  });

  it("keeps on-screen data when an INVALIDATION empties the row and the refetch FAILS", async () => {
    // The critical case. `invalidateHome()` DELETES `cached_home`, which is a
    // write, so the bus fires. A plain `reload()` would read null and push it into
    // state — and HomeContainer derives `isLoading` from `data === null`, so the
    // whole Home screen became a spinner with nothing to clear it (the mount
    // auto-refresh is one-shot per userId). Tapping "Weigh in" was enough, and
    // offline it never recovered.
    //
    // The fetcher FAILS here deliberately, to isolate "the invalidation itself
    // must not blank the screen" from "a successful refetch replaces the data".
    const storage = new InMemoryStorageAdapter();
    storage.initialize();
    writeCache(storage, 5);
    const adapters = makeAdapters(new InMemoryApiAdapter(), storage);

    const { result } = renderHook(
      () =>
        useCachedResource({
          ...scalarConfig(async () =>
            fail({ kind: "api", code: "server", message: "offline" }),
          ),
          tables: ["cell_table"],
        }),
      { wrapper: wrap(adapters) },
    );
    expect(result.current.data).toBe(5);

    storage.cacheHabitCompletions(USER, []); // the row is now empty
    await act(async () => {
      storage.emitChange("cell_table");
    });

    // Data survives the invalidation, and is marked stale so it will be replaced.
    expect(result.current.data).toBe(5);
    expect(result.current.isStale).toBe(true);
  });

  it("replaces the data once the invalidation-triggered refetch succeeds", async () => {
    // The other half: an invalidation must actually cause a REFETCH, not just
    // preserve stale data — otherwise `invalidateHome()` would stop working.
    const storage = new InMemoryStorageAdapter();
    storage.initialize();
    writeCache(storage, 5);
    const adapters = makeAdapters(new InMemoryApiAdapter(), storage);

    const { result } = renderHook(
      () =>
        useCachedResource({
          ...scalarConfig(async () => ok(99)),
          tables: ["cell_table"],
        }),
      { wrapper: wrap(adapters) },
    );

    storage.cacheHabitCompletions(USER, []);
    await act(async () => {
      storage.emitChange("cell_table");
    });

    await waitFor(() => expect(result.current.data).toBe(99));
  });

  it("ignores writes to tables it did not declare", () => {
    const storage = new InMemoryStorageAdapter();
    storage.initialize();
    writeCache(storage, 1);
    const adapters = makeAdapters(new InMemoryApiAdapter(), storage);

    const { result } = renderHook(() => useCachedResource(subscribedConfig()), {
      wrapper: wrap(adapters),
    });

    writeCache(storage, 7);
    act(() => storage.emitChange("some_other_table"));

    expect(result.current.data).toBe(1);
  });

  it("registers no subscription when `tables` is omitted", () => {
    const storage = new InMemoryStorageAdapter();
    storage.initialize();
    const adapters = makeAdapters(new InMemoryApiAdapter(), storage);

    renderHook(() => useCachedResource(scalarConfig(async () => ok(1))), {
      wrapper: wrap(adapters),
    });

    expect(storage.changeSubscriberCount()).toBe(0);
  });
});

/**
 * `enabled` (launch fan-out reduction, ships alongside the always-mounted
 * bottom sheets — see feedback_sheets_mount_at_root). A cold app launch
 * mounts seven bottom sheets as permanent siblings of the Stack; before this
 * flag, each one's data hook auto-refreshed on mount regardless of whether
 * the sheet's `open`/`visible` store flag was true, firing ~28 requests
 * within 100ms against a 10-concurrency Lambda quota (~16 came back 503).
 */
describe("useCachedResource — `enabled` gate (launch fan-out reduction)", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("disabled on mount: no network fetch, but the cached value still reads synchronously", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    // Present-but-stale cache, same shape a closed sheet would see: it must
    // still render instantly from cache even though the network call is
    // gated off.
    writeCache(storage, 5);
    const fetcher = jest.fn(async () => ok(42));

    const { result } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        useCachedResource({ ...staleConfig(fetcher), enabled }),
      {
        initialProps: { enabled: false },
        wrapper: wrap(makeAdapters(api, storage)),
      },
    );

    // Cached snapshot renders immediately — `enabled` only gates the
    // AUTOMATIC network fetch, never the synchronous cache read.
    expect(result.current.data).toBe(5);

    // Let any timers/microtasks that a (bugged) auto-refresh might have
    // queued run to completion.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(6000);
    });
    expect(fetcher).not.toHaveBeenCalled();
    expect(result.current.data).toBe(5);
  });

  it("disabled → enabled flip fetches exactly once (the sheet's first real open)", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    const fetcher = jest.fn(async () => ok(42));

    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        useCachedResource({ ...staleConfig(fetcher), enabled }),
      {
        initialProps: { enabled: false },
        wrapper: wrap(makeAdapters(api, storage)),
      },
    );
    await act(async () => {
      await jest.advanceTimersByTimeAsync(6000);
    });
    expect(fetcher).not.toHaveBeenCalled();

    // The sheet opens — `enabled` flips true.
    rerender({ enabled: true });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(6000);
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.current.data).toBe(42);

    // Re-rendering with `enabled` still true must not re-fire it (one-shot
    // latch, same as the always-enabled path).
    rerender({ enabled: true });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(6000);
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("refresh() still works while disabled (pull-to-refresh / an explicit caller is never gated)", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    writeCache(storage, 5);
    const fetcher = jest.fn(async () => ok(42));

    const { result } = renderHook(
      () => useCachedResource({ ...staleConfig(fetcher), enabled: false }),
      { wrapper: wrap(makeAdapters(api, storage)) },
    );
    expect(fetcher).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.refresh();
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.current.data).toBe(42);
  });

  it("a bus-driven invalidation while disabled marks staleness but does NOT spend a request", async () => {
    const storage = new InMemoryStorageAdapter();
    storage.initialize();
    writeCache(storage, 5);
    const adapters = makeAdapters(new InMemoryApiAdapter(), storage);
    const fetcher = jest.fn(async () => ok(99));

    const { result } = renderHook(
      () =>
        useCachedResource({
          ...scalarConfig(fetcher),
          tables: ["cell_table"],
          enabled: false,
        }),
      { wrapper: wrap(adapters) },
    );
    expect(result.current.data).toBe(5);

    storage.cacheHabitCompletions(USER, []); // the row is invalidated
    act(() => storage.emitChange("cell_table"));

    // Staleness still surfaces (so the eventual open's mount auto-refresh
    // fires), but no request was spent while nobody's looking.
    expect(result.current.isStale).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("a bus-driven invalidation while disabled bumps `cacheVersion` so `initialIsStale` reflects reality on reopen (not just local `isStale` state)", async () => {
    // A hook with REAL TTL-based staleness (unlike `useGetMeals`/
    // `useGetRecipes`, which hardcode `isStale: true`) — `read` reports
    // stale iff the cached value is absent. This is what makes the bug in
    // finding #4 observable: without bumping `cacheVersion` alongside
    // `setIsStale(true)`, `initial`/`initialIsStale` (the arming effect's
    // OWN gate) never re-reads storage and would report "not stale" even
    // after the row was deleted.
    const storage = new InMemoryStorageAdapter();
    storage.initialize();
    writeCache(storage, 5);
    const adapters = makeAdapters(new InMemoryApiAdapter(), storage);
    const fetcher = jest.fn(async () => ok(99));
    const realStalenessConfig = {
      ...scalarConfig(fetcher),
      read: (storage: StoragePort, userId: string) => {
        const rows = storage.getCachedHabitCompletions(userId, {
          goalId: "cell",
        });
        return { value: rows[0]?.value ?? null, isStale: rows.length === 0 };
      },
      tables: ["cell_table"],
      enabled: false,
    };

    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        useCachedResource({ ...realStalenessConfig, enabled }),
      { initialProps: { enabled: false }, wrapper: wrap(adapters) },
    );
    expect(result.current.data).toBe(5);

    storage.cacheHabitCompletions(USER, []); // the row is invalidated
    act(() => storage.emitChange("cell_table"));
    expect(fetcher).not.toHaveBeenCalled(); // still disabled — no request

    // Reopen. Without the `cacheVersion` bump, `initialIsStale` would still
    // reflect the PRE-invalidation read (not stale) and the arming effect
    // would skip refetching entirely.
    rerender({ enabled: true });
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.data).toBe(99));
  });
});

/**
 * Inspector Brad finding (launch fan-out pass): a sheet CLOSE (`enabled:
 * true → false`) re-runs the mount-effect's cleanup because `enabled` is a
 * dependency, but the component STAYS MOUNTED — it is not an unmount. Before
 * the fix, the cleanup only ever set `cancelled = true`; the async IIFE's own
 * `finally` skips `setIsRefreshing(false)` once `cancelled` is true (that
 * guard exists for the unmount/userId-change case), so closing mid-fetch left
 * `isRefreshing` stuck forever on the success path and silently swallowed the
 * error on the failure path — AND `autoRefreshedRef` was already armed before
 * the async work even started, so reopening was a permanent no-op regardless
 * of outcome.
 */
describe("useCachedResource — closing (enabled→false) mid-fetch — close is not unmount", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("resets isRefreshing immediately on close (success path) instead of stranding it — the eventual response still lands", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    // Stale-but-present cache → single attempt (no cold-start retry noise).
    writeCache(storage, 5);
    let resolveFetch: ((r: Result<number, ApiError>) => void) | null = null;
    const gate = new Promise<Result<number, ApiError>>((resolve) => {
      resolveFetch = resolve;
    });
    const fetcher = jest.fn(() => gate);

    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        useCachedResource({ ...staleConfig(fetcher), enabled }),
      {
        initialProps: { enabled: true },
        wrapper: wrap(makeAdapters(api, storage)),
      },
    );

    // Let the mount auto-refresh get past the sync-queue drain and into the
    // actual (still-pending) fetch.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.current.isRefreshing).toBe(true);

    // The sheet closes WHILE the fetch is still in flight.
    rerender({ enabled: false });
    // The reset happens SYNCHRONOUSLY in the cleanup — no need to wait for
    // the abandoned fetch to settle.
    expect(result.current.isRefreshing).toBe(false);

    // The abandoned fetch eventually resolves successfully — the response
    // still lands (not wasted), and `isRefreshing` does not flip back on.
    await act(async () => {
      resolveFetch?.(ok(42));
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(result.current.data).toBe(42);
    expect(result.current.isRefreshing).toBe(false);
  });

  it("un-arms the latch on close (failure path) so the next open genuinely refetches, instead of silently swallowing the error forever", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    writeCache(storage, 5);
    let rejectFetch: ((r: Result<number, ApiError>) => void) | null = null;
    const gate = new Promise<Result<number, ApiError>>((resolve) => {
      rejectFetch = resolve;
    });
    const fetcher = jest
      .fn<Promise<Result<number, ApiError>>, [ApiPort]>()
      .mockReturnValueOnce(gate)
      .mockResolvedValue(ok(7));

    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        useCachedResource({ ...staleConfig(fetcher), enabled }),
      {
        initialProps: { enabled: true },
        wrapper: wrap(makeAdapters(api, storage)),
      },
    );
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(fetcher).toHaveBeenCalledTimes(1);

    // Close WHILE the fetch is still in flight.
    rerender({ enabled: false });
    expect(result.current.isRefreshing).toBe(false);

    // The abandoned attempt fails — swallowed (not surfaced as `error`); the
    // stale cache stays exactly as it was.
    await act(async () => {
      rejectFetch?.(fail({ kind: "api", code: "timeout", message: "slow" }));
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(result.current.error).toBeNull();
    expect(result.current.data).toBe(5);

    // Reopen: the latch was un-armed on close, so this is a genuine new
    // mount auto-refresh — not a silent no-op.
    rerender({ enabled: true });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(result.current.data).toBe(7));
  });

  // The sibling test above resolves the abandoned fetch BEFORE reopening, so
  // `inFlightRef` is already free by then. Reopening INSIDE that window is the
  // harder case: the cleanup un-arms the latch synchronously, but
  // `inFlightRef` stays `true` until the abandoned promise settles, so the
  // arming effect early-returns without arming — and on the failure path
  // nothing else re-renders, so without the `retryTick` nudge the resource
  // stays open with no data, no error and no spinner for the rest of the
  // session.
  it("reopening BEFORE the abandoned fetch settles still refetches once it does (failure path)", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    // Empty cache → the cold-start path, which is where a slow first request
    // makes this window widest in practice.
    let rejectFetch: ((r: Result<number, ApiError>) => void) | null = null;
    const gate = new Promise<Result<number, ApiError>>((resolve) => {
      rejectFetch = resolve;
    });
    const fetcher = jest
      .fn<Promise<Result<number, ApiError>>, [ApiPort]>()
      .mockReturnValueOnce(gate)
      .mockResolvedValue(ok(9));

    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        useCachedResource({ ...staleConfig(fetcher), enabled }),
      {
        initialProps: { enabled: true },
        wrapper: wrap(makeAdapters(api, storage)),
      },
    );
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(fetcher).toHaveBeenCalledTimes(1);

    // Close, then REOPEN while attempt 1 is still in flight.
    rerender({ enabled: false });
    rerender({ enabled: true });
    // Still only the one in-flight request — the arming effect correctly
    // declined to start a second concurrent fetch.
    expect(fetcher).toHaveBeenCalledTimes(1);

    // Now the abandoned attempt fails. The slot frees, and the nudge re-runs
    // the arming effect for the (re-opened) resource.
    await act(async () => {
      rejectFetch?.(fail({ kind: "api", code: "timeout", message: "slow" }));
      await jest.advanceTimersByTimeAsync(0);
    });

    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.data).toBe(9));
    expect(result.current.error).toBeNull();
    expect(result.current.isRefreshing).toBe(false);
  });
});
