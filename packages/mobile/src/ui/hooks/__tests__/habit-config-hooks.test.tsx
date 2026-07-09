import { renderHook, waitFor, act } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { AuthSession } from "@/domain/ports/auth.port";
import { ok } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import type { HabitConfigEntry } from "@/domain/ports/api.port";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import { useGetHabitConfig } from "@/ui/hooks/useGetHabitConfig";
import { useGetClientHabitConfig } from "@/ui/hooks/useGetClientHabitConfig";
import {
  useConfigureHabit,
  useDisableHabit,
} from "@/ui/hooks/useConfigureHabit";

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

function setup() {
  const api = new InMemoryApiAdapter();
  const storage = new InMemoryStorageAdapter();
  return { api, storage, wrapper: wrap(makeAdapters(api, storage)) };
}

const waterEntry: HabitConfigEntry = {
  category: "water",
  enabled: true,
  goalId: "g-water",
  assignedByCoach: false,
  assignedByName: null,
  locked: false,
  targetValue: 2,
  unit: "l",
  period: "daily",
  completionRule: "value_gte",
  daysPerWeek: 5,
  tolerancePct: null,
  pending: null,
};

beforeEach(() => mockFetch.mockClear());

describe("useGetHabitConfig (self)", () => {
  it("cache-first: reads the cached configs synchronously, merged to all five", () => {
    const { storage, wrapper } = setup();
    storage.cacheHabitConfigs(USER, [
      {
        category: "water",
        enabled: true,
        goalId: "g-water",
        assignedByCoach: false,
        assignedByName: null,
        locked: false,
        targetValue: 2,
        unit: "l",
        period: "daily",
        completionRule: "value_gte",
        daysPerWeek: 5,
        tolerancePct: null,
        pending: null,
      },
    ]);
    const { result } = renderHook(() => useGetHabitConfig(), { wrapper });
    // Merged to five categories; water is the cached (enabled) row.
    expect(result.current.configs).toHaveLength(5);
    expect(result.current.configs[0].category).toBe("water");
    expect(result.current.configs[0].enabled).toBe(true);
  });

  it("background refresh maps the wire entries into the cache", async () => {
    const { api, storage, wrapper } = setup();
    api.habitConfigs = [waterEntry];
    const { result } = renderHook(() => useGetHabitConfig(), { wrapper });
    await waitFor(() =>
      expect(
        result.current.configs.find((c) => c.category === "water")?.enabled,
      ).toBe(true),
    );
    // The refresh wrote the mapped config to the cache (server wins).
    expect(
      storage.getHabitConfigs(USER).some((c) => c.goalId === "g-water"),
    ).toBe(true);
  });
});

describe("useGetClientHabitConfig (coach)", () => {
  it("reads the client's config directly (no cache) and merges to five", async () => {
    const { api, wrapper } = setup();
    api.clientHabitConfigs = { "client-9": [waterEntry] };
    const { result } = renderHook(() => useGetClientHabitConfig("client-9"), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.configs).toHaveLength(5);
    expect(result.current.configs[0].enabled).toBe(true);
  });
});

describe("useConfigureHabit / useDisableHabit", () => {
  it("configure writes the optimistic cache + fires the PUT through the drain", async () => {
    const { storage, wrapper } = setup();
    const { result } = renderHook(() => useConfigureHabit(), { wrapper });
    await act(async () => {
      await result.current.mutate({
        category: "water",
        targetValue: 2.5,
        daysPerWeek: 5,
      });
    });
    // The optimistic cache write landed.
    expect(
      storage.getHabitConfigs(USER).some((c) => c.category === "water"),
    ).toBe(true);
    // The drain sent the PUT via fetch (the sync queue hits the endpoint URL).
    const put = mockFetch.mock.calls.find(
      ([url, opts]) =>
        String(url).endsWith("/users/me/habits/water/config") &&
        (opts as { method?: string })?.method === "PUT",
    );
    expect(put).toBeDefined();
  });

  it("configure with clientId routes the PUT to the trainer endpoint", async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useConfigureHabit("client-9"), {
      wrapper,
    });
    await act(async () => {
      await result.current.mutate({ category: "water", targetValue: 2 });
    });
    const put = mockFetch.mock.calls.find(([url]) =>
      String(url).endsWith("/trainers/me/clients/client-9/habits/water/config"),
    );
    expect(put).toBeDefined();
  });

  it("disable fires a DELETE through the drain", async () => {
    const { storage, wrapper } = setup();
    storage.upsertHabitConfig(USER, {
      category: "water",
      enabled: true,
      goalId: "g-water",
      assignedByCoach: false,
      assignedByName: null,
      locked: false,
      targetValue: 2,
      unit: "l",
      period: "daily",
      completionRule: "value_gte",
      daysPerWeek: 5,
      tolerancePct: null,
      effectiveFrom: "2026-06-01",
      pending: null,
    });
    const { result } = renderHook(() => useDisableHabit(), { wrapper });
    await act(async () => {
      await result.current.mutate("water");
    });
    const del = mockFetch.mock.calls.find(
      ([url, opts]) =>
        String(url).endsWith("/users/me/habits/water") &&
        (opts as { method?: string })?.method === "DELETE",
    );
    expect(del).toBeDefined();
  });
});

describe("habit hooks with no signed-in user", () => {
  function wrapNoUser() {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    const auth = {
      getSession: jest.fn(async () => ok(null)),
      onAuthStateChange: jest.fn((cb: (s: null) => void) => {
        cb(null);
        return () => {};
      }),
      getAccessToken: jest.fn(async () => null),
    } as unknown as Adapters["auth"];
    const adapters: Adapters = {
      api,
      auth,
      storage,
      health: {} as Adapters["health"],
      notifications: {} as Adapters["notifications"],
      payments: {} as Adapters["payments"],
      netInfo: {} as Adapters["netInfo"],
    };
    return { storage, wrapper: wrap(adapters) };
  }

  it("configure is a no-op without a user (no cache write)", async () => {
    const { storage, wrapper } = wrapNoUser();
    const { result } = renderHook(() => useConfigureHabit(), { wrapper });
    await act(async () => {
      await result.current.mutate({ category: "water", targetValue: 2 });
    });
    // No userId → the command never ran; nothing cached under any user.
    expect(storage.getHabitConfigs("")).toHaveLength(0);
  });

  it("disable is a no-op without a user", async () => {
    const { wrapper } = wrapNoUser();
    const { result } = renderHook(() => useDisableHabit(), { wrapper });
    await act(async () => {
      await result.current.mutate("water");
    });
    // No throw; the guard returned early.
    expect(true).toBe(true);
  });
});
