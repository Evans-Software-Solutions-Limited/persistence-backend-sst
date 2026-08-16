import { renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";

jest.mock("@/adapters/api", () => ({
  getApiBaseUrl: () => "https://api.test",
}));

// eslint-disable-next-line import/first
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
// eslint-disable-next-line import/first
import { InMemoryAuthAdapter } from "@/adapters/auth/__tests__/in-memory-auth.adapter";
// eslint-disable-next-line import/first
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
// eslint-disable-next-line import/first
import { StubHealthAdapter } from "@/adapters/health";
// eslint-disable-next-line import/first
import { StubNotificationsAdapter } from "@/adapters/notifications";
// eslint-disable-next-line import/first
import { InMemoryNetInfoAdapter } from "@/adapters/netInfo/__tests__/InMemoryNetInfoAdapter";
// eslint-disable-next-line import/first
import type { Adapters } from "@/shared/types";
// eslint-disable-next-line import/first
import type { RecentSetEntry } from "@/domain/ports/storage.port";
// eslint-disable-next-line import/first
import { AdapterProvider } from "@/ui/hooks/useAdapters";
// eslint-disable-next-line import/first
import { useHydrateRecentSets } from "@/ui/hooks/useHydrateRecentSets";

function wrapper(adapters: Adapters) {
  return function TestWrapper({ children }: { children: ReactNode }) {
    return <AdapterProvider adapters={adapters}>{children}</AdapterProvider>;
  };
}

function makeAdapters(): {
  adapters: Adapters;
  storage: InMemoryStorageAdapter;
  auth: InMemoryAuthAdapter;
  api: InMemoryApiAdapter;
} {
  const storage = new InMemoryStorageAdapter();
  const auth = new InMemoryAuthAdapter();
  const api = new InMemoryApiAdapter();
  const adapters: Adapters = {
    api,
    auth,
    storage,
    health: new StubHealthAdapter(),
    notifications: new StubNotificationsAdapter(),
    netInfo: new InMemoryNetInfoAdapter(),
  };
  return { adapters, storage, auth, api };
}

function signIn(auth: InMemoryAuthAdapter) {
  auth.currentSession = {
    accessToken: "tok",
    refreshToken: "rtok",
    userId: "u-1",
    email: "x@y.com",
    expiresAt: Date.now() + 3_600_000,
  };
}

const serverSets: RecentSetEntry[] = [
  {
    exerciseId: "ex-bench",
    setNumber: 1,
    weightKg: 60,
    reps: 8,
    recordedAt: "2026-08-07T14:25:28.838Z",
  },
];

describe("useHydrateRecentSets", () => {
  afterEach(() => jest.restoreAllMocks());

  it("hydrates the local cache from the server on a fresh (empty) install", async () => {
    const { adapters, storage, api, auth } = makeAdapters();
    signIn(auth);
    api.recentSets = serverSets;

    renderHook(() => useHydrateRecentSets(), { wrapper: wrapper(adapters) });

    await waitFor(() => {
      expect(storage.getRecentSetsByExercise("u-1", ["ex-bench"])).toEqual({
        "ex-bench": { 1: { weightKg: 60, reps: 8 } },
      });
    });
  });

  it("does not fetch when the user is signed out", async () => {
    const { adapters, api } = makeAdapters();
    const spy = jest.spyOn(api, "getRecentSets");

    renderHook(() => useHydrateRecentSets(), { wrapper: wrapper(adapters) });

    await new Promise((r) => setTimeout(r, 10));
    expect(spy).not.toHaveBeenCalled();
  });

  it("skips hydration when the cache already has entries", async () => {
    const { adapters, storage, api, auth } = makeAdapters();
    signIn(auth);
    storage.upsertRecentSets("u-1", [
      {
        exerciseId: "ex-squat",
        setNumber: 1,
        weightKg: 100,
        reps: 5,
        recordedAt: "2026-08-10T10:00:00.000Z",
      },
    ]);
    const spy = jest.spyOn(api, "getRecentSets");
    api.recentSets = serverSets;

    renderHook(() => useHydrateRecentSets(), { wrapper: wrapper(adapters) });

    await new Promise((r) => setTimeout(r, 10));
    expect(spy).not.toHaveBeenCalled();
    // Local entry untouched.
    expect(storage.getRecentSetsByExercise("u-1", ["ex-squat"])).toEqual({
      "ex-squat": { 1: { weightKg: 100, reps: 5 } },
    });
  });
});
