import { renderHook, act, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { AuthSession } from "@/domain/ports/auth.port";
import type { ApiPort } from "@/domain/ports/api.port";
import type { StoragePort } from "@/domain/ports/storage.port";
import { ok, type Result, type ApiError } from "@/shared/errors";
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
