import { renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { AuthSession } from "@/domain/ports/auth.port";
import { ok } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import { useLogSleep } from "@/ui/hooks/useLogSleep";

jest.mock("@/adapters/api", () => ({
  ...jest.requireActual("@/adapters/api"),
  getApiBaseUrl: () => "https://api.test",
}));

const mockFetch = jest.fn(async () => ({
  ok: true,
  status: 200,
  headers: { get: () => null },
  json: async () => ({ data: {} }),
}));
(globalThis as Record<string, unknown>).fetch = mockFetch;

const USER = "user-1";

function makeAdapters(session: AuthSession | null): {
  adapters: Adapters;
  storage: InMemoryStorageAdapter;
} {
  const storage = new InMemoryStorageAdapter();
  const auth = {
    getSession: jest.fn(async () => ok(session)),
    onAuthStateChange: jest.fn((cb: (s: AuthSession | null) => void) => {
      cb(session);
      return () => {};
    }),
    getAccessToken: jest.fn(async () => "t"),
  } as unknown as Adapters["auth"];
  return {
    storage,
    adapters: {
      api: {} as Adapters["api"],
      auth,
      storage,
      health: {} as Adapters["health"],
      notifications: {} as Adapters["notifications"],
      payments: {} as Adapters["payments"],
      netInfo: {} as Adapters["netInfo"],
    },
  };
}

function wrap(adapters: Adapters) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <AdapterProvider adapters={adapters}>{children}</AdapterProvider>;
  };
}

describe("useLogSleep", () => {
  beforeEach(() => mockFetch.mockClear());

  it("logs sleep and drains the queue", async () => {
    const session: AuthSession = {
      accessToken: "t",
      refreshToken: "r",
      userId: USER,
      email: "u@example.com",
      expiresAt: Date.now() + 60_000,
    };
    const { adapters } = makeAdapters(session);
    const { result } = renderHook(() => useLogSleep(), {
      wrapper: wrap(adapters),
    });

    const res = await result.current.mutate({
      sleepDate: "2026-07-16",
      durationMinutes: 450,
    });

    expect(res.ok).toBe(true);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    const [url, init] = mockFetch.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://api.test/health/sleep");
    expect(init.method).toBe("POST");
  });

  it("rejects when there is no signed-in user (no queue write)", async () => {
    const { adapters, storage } = makeAdapters(null);
    const { result } = renderHook(() => useLogSleep(), {
      wrapper: wrap(adapters),
    });

    const res = await result.current.mutate({
      sleepDate: "2026-07-16",
      durationMinutes: 450,
    });

    expect(res.ok).toBe(false);
    expect(storage.getPendingMutations()).toHaveLength(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("surfaces the command's validation failure without touching the queue", async () => {
    const session: AuthSession = {
      accessToken: "t",
      refreshToken: "r",
      userId: USER,
      email: "u@example.com",
      expiresAt: Date.now() + 60_000,
    };
    const { adapters, storage } = makeAdapters(session);
    const { result } = renderHook(() => useLogSleep(), {
      wrapper: wrap(adapters),
    });

    const res = await result.current.mutate({
      sleepDate: "2026-07-16",
      durationMinutes: 0,
    });

    expect(res.ok).toBe(false);
    expect(storage.getPendingMutations()).toHaveLength(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
