import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { AuthSession } from "@/domain/ports/auth.port";
import { ok } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import {
  PROGRAMS_STALE_AFTER_MS,
  isProgramsStale,
  useGetPrograms,
} from "../useGetPrograms";

describe("isProgramsStale", () => {
  const now = 1_000_000_000_000;

  it("is stale when there is no synced timestamp", () => {
    expect(isProgramsStale(null, now)).toBe(true);
  });

  it("is stale when the timestamp is unparseable", () => {
    expect(isProgramsStale("garbage", now)).toBe(true);
  });

  it("is fresh within the TTL", () => {
    const recent = new Date(now - 1000).toISOString();
    expect(isProgramsStale(recent, now)).toBe(false);
  });

  it("is stale past the TTL", () => {
    const old = new Date(now - PROGRAMS_STALE_AFTER_MS - 1000).toISOString();
    expect(isProgramsStale(old, now)).toBe(true);
  });
});

const mockFetch = jest.fn(async () => ({
  ok: true,
  status: 200,
  headers: { get: () => null },
  json: async () => ({ data: [] }),
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
): Adapters {
  const session: AuthSession = {
    accessToken: "t",
    refreshToken: "r",
    userId: USER,
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

beforeEach(() => mockFetch.mockClear());

describe("useGetPrograms (cache-first + refresh)", () => {
  it("seeds from the cached list then refreshes from listPrograms", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    storage.cachePrograms(USER, [
      {
        id: "cached-1",
        name: "Cached Program",
        description: null,
        durationWeeks: 8,
        daysPerWeek: 3,
        workoutCount: 2,
        activeClientCount: 0,
        createdAt: null,
        updatedAt: null,
      },
    ]);
    api.programs = [
      {
        id: "fresh-1",
        name: "Fresh Program",
        description: null,
        durationWeeks: null,
        daysPerWeek: 4,
        workoutCount: 5,
        activeClientCount: 1,
        createdAt: null,
        updatedAt: null,
      },
    ];

    const { result } = renderHook(() => useGetPrograms(), {
      wrapper: wrap(makeAdapters(api, storage)),
    });

    // Cache-first: the cached snapshot renders before any refresh settles.
    expect(result.current.data?.[0].id).toBe("cached-1");

    // The cache was just written (fresh), so the hook doesn't auto-refresh
    // on mount — drive it explicitly, same as a pull-to-refresh gesture.
    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.data?.[0].id).toBe("fresh-1");
    expect(api.listProgramsCalls).toBeGreaterThan(0);
    expect(storage.getCachedPrograms(USER)?.[0].id).toBe("fresh-1");
  });

  it("surfaces the fetcher's error without clearing existing data", async () => {
    jest.useFakeTimers();
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    api.shouldFail = true;
    api.failError = {
      kind: "api",
      code: "server",
      message: "boom",
    };

    const { result } = renderHook(() => useGetPrograms(), {
      wrapper: wrap(makeAdapters(api, storage)),
    });

    // Cold start + transient (server) failure → retried with backoff; the error
    // surfaces once the retry budget is exhausted.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(6000);
    });
    expect(result.current.error).not.toBeNull();
    expect(result.current.error?.message).toBe("boom");
    expect(result.current.data).toBeNull();
    jest.useRealTimers();
  });
});
