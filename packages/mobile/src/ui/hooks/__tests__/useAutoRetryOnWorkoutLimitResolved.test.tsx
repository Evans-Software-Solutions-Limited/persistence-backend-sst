import { act, renderHook, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// Mock the API base URL helper — the hook reads it before calling
// processSyncQueue, and the adapter file throws if EXPO_PUBLIC_API_URL
// isn't set in the test env.
jest.mock("@/adapters/api", () => ({
  getApiBaseUrl: () => "https://api.test",
}));

// `useWorkoutTotalCapGate` (pulled in transitively via
// `useAutoRetryOnWorkoutLimitResolved`) imports the expo-router singleton
// for its navigation callbacks. Unmocked, requiring it pulls in React
// Native's dev-server plumbing and the suite fails to load before a
// single assertion runs (see useLoadoutGate.test.tsx for the same trap).
jest.mock("expo-router", () => ({
  __esModule: true,
  router: { push: jest.fn(), back: jest.fn() },
}));

// eslint-disable-next-line import/first
import { WORKOUT_TABLES } from "@/adapters/storage";
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
import type { MySubscription } from "@/domain/models/subscription";
// eslint-disable-next-line import/first
import type { Adapters } from "@/shared/types";
// eslint-disable-next-line import/first
import { AdapterProvider } from "@/ui/hooks/useAdapters";
// eslint-disable-next-line import/first
import { useAutoRetryOnWorkoutLimitResolved } from "@/ui/hooks/useAutoRetryOnWorkoutLimitResolved";

const mockFetch = jest.fn();
(globalThis as Record<string, unknown>).fetch = mockFetch;

function wrapper(adapters: Adapters, queryClient: QueryClient) {
  function TestWrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <AdapterProvider adapters={adapters}>{children}</AdapterProvider>
      </QueryClientProvider>
    );
  }
  return TestWrapper;
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

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
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

function freeSub(workoutLimit: number | null = 3): MySubscription {
  return {
    subscriptionId: null,
    tierName: "free",
    paymentStatus: "active",
    billingCycle: null,
    startsAt: "2026-01-01T00:00:00.000Z",
    expiresAt: null,
    cancelledAt: null,
    trialEndsAt: null,
    externalSubscriptionId: null,
    tierDisplayName: "Free",
    tierDescription: null,
    workoutLimit,
    aiAccess: false,
    aiWorkoutLimit: 0,
    gymBuddyAccess: false,
    trainerClientLimit: null,
    isTrainerTier: false,
    role: "user",
    hasUsedUserTrial: false,
    hasUsedTrainerTrial: false,
    isEligibleForUserTrial: true,
    isEligibleForTrainerTrial: true,
    scheduledChange: null,
  };
}

/** Seed the `mine` quota AND announce the write on the change bus, matching
 * how a real delete flows (write + `emitChange`) so `useWorkouts()`'s
 * `useCacheRevision` subscriber picks up the new count. */
function setWorkoutCount(
  storage: InMemoryStorageAdapter,
  userId: string,
  used: number,
  limit: number | null,
) {
  storage.cacheWorkoutsList(userId, "mine", [], { used, limit });
  storage.cacheWorkoutsList(userId, "assigned", [], null);
  storage.cacheWorkoutsList(userId, "default", [], null);
  storage.emitChange(...WORKOUT_TABLES);
}

function enqueueBlockedWorkoutLimitExceeded(storage: InMemoryStorageAdapter) {
  storage.enqueueMutation({
    entityType: "session",
    operation: "create",
    payload: {},
    endpoint: "/sessions/record",
    method: "POST",
  });
  const id = storage.getPendingMutations().slice(-1)[0].id;
  storage.markMutationBlocked(id, {
    feature: "create_workout",
    currentTier: "free",
    upgradeTo: "premium",
    upgradePriceMonthly: 12.99,
    blockedAt: "2026-05-24T10:00:00.000Z",
    reason: "workout_limit_exceeded",
  });
  return id;
}

describe("useAutoRetryOnWorkoutLimitResolved", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
    jest.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("does nothing on first render even while already over-limit with blocked entries (seed-not-trigger)", async () => {
    const { adapters, storage, api, auth } = makeAdapters();
    signIn(auth);
    api.mySubscription = freeSub(3);
    setWorkoutCount(storage, "u-1", 5, 3); // over limit from the start
    enqueueBlockedWorkoutLimitExceeded(storage);

    renderHook(() => useAutoRetryOnWorkoutLimitResolved(), {
      wrapper: wrapper(adapters, makeQueryClient()),
    });

    await waitFor(() => expect(api.mySubscription).toBeDefined());
    // Give useWorkouts' cache read a tick to settle.
    await new Promise((r) => setTimeout(r, 10));
    expect(storage.getBlockedEntries()).toHaveLength(1);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("REVERT-VERIFY: unblocks + reprocesses a blocked workout_limit_exceeded entry when the count drops to ≤ limit via DELETION — tier unchanged throughout", async () => {
    const { adapters, storage, api, auth } = makeAdapters();
    signIn(auth);
    api.mySubscription = freeSub(3);
    setWorkoutCount(storage, "u-1", 4, 3); // over limit: 4 > 3
    enqueueBlockedWorkoutLimitExceeded(storage);

    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });

    renderHook(() => useAutoRetryOnWorkoutLimitResolved(), {
      wrapper: wrapper(adapters, makeQueryClient()),
    });

    await waitFor(() => expect(api.mySubscription).toBeDefined());
    // Seed observed — first render doesn't trigger.
    await new Promise((r) => setTimeout(r, 10));
    expect(storage.getBlockedEntries()).toHaveLength(1);

    // Delete a workout: count drops to 3 (at the limit, not over). Tier
    // is untouched — this is the path `useAutoRetryOnUpgrade` (keyed on
    // tier transitions only) can NEVER see, which is the whole point of
    // this test failing if the trigger were keyed on tier alone.
    act(() => setWorkoutCount(storage, "u-1", 3, 3));

    await waitFor(
      () => {
        expect(storage.getBlockedEntries()).toHaveLength(0);
      },
      { timeout: 5_000 },
    );
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("does NOT unblock on a FALSE → TRUE transition (newly over-limit has nothing to unblock)", async () => {
    const { adapters, storage, api, auth } = makeAdapters();
    signIn(auth);
    api.mySubscription = freeSub(3);
    setWorkoutCount(storage, "u-1", 2, 3); // under limit at mount

    renderHook(() => useAutoRetryOnWorkoutLimitResolved(), {
      wrapper: wrapper(adapters, makeQueryClient()),
    });
    await waitFor(() => expect(api.mySubscription).toBeDefined());
    await new Promise((r) => setTimeout(r, 10));

    // Now enqueue a blocked entry AFTER mount, then cross over the limit.
    enqueueBlockedWorkoutLimitExceeded(storage);
    act(() => setWorkoutCount(storage, "u-1", 4, 3));

    await new Promise((r) => setTimeout(r, 10));
    expect(storage.getBlockedEntries()).toHaveLength(1);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("does not touch a blocked entry whose reason is NOT workout_limit_exceeded", async () => {
    const { adapters, storage, api, auth } = makeAdapters();
    signIn(auth);
    api.mySubscription = freeSub(3);
    setWorkoutCount(storage, "u-1", 4, 3);
    storage.enqueueMutation({
      entityType: "workout",
      operation: "create",
      payload: {},
      endpoint: "/workouts",
      method: "POST",
    });
    const otherId = storage.getPendingMutations().slice(-1)[0].id;
    storage.markMutationBlocked(otherId, {
      feature: "create_workout",
      currentTier: "free",
      upgradeTo: "premium",
      upgradePriceMonthly: 12.99,
      blockedAt: "2026-05-24T10:00:00.000Z",
      reason: "limit",
    });

    renderHook(() => useAutoRetryOnWorkoutLimitResolved(), {
      wrapper: wrapper(adapters, makeQueryClient()),
    });
    await waitFor(() => expect(api.mySubscription).toBeDefined());
    await new Promise((r) => setTimeout(r, 10));

    act(() => setWorkoutCount(storage, "u-1", 3, 3));

    await new Promise((r) => setTimeout(r, 50));
    // The 'limit' entry is untouched — this hook only acts on
    // workout_limit_exceeded.
    expect(storage.getBlockedEntries()).toHaveLength(1);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("also unblocks on resolution via UPGRADE (tier changes to unlimited)", async () => {
    const { adapters, storage, api, auth } = makeAdapters();
    signIn(auth);
    api.mySubscription = freeSub(3);
    setWorkoutCount(storage, "u-1", 4, 3);
    enqueueBlockedWorkoutLimitExceeded(storage);

    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });

    const queryClient = makeQueryClient();
    renderHook(() => useAutoRetryOnWorkoutLimitResolved(), {
      wrapper: wrapper(adapters, queryClient),
    });
    await waitFor(() => expect(api.mySubscription).toBeDefined());
    await new Promise((r) => setTimeout(r, 10));
    expect(storage.getBlockedEntries()).toHaveLength(1);

    // Upgrade to premium — unlimited workoutLimit=null. Count stays at 4
    // (no deletion), but the gate now resolves not-over-limit.
    act(() => {
      api.mySubscription = {
        ...freeSub(3),
        tierName: "premium",
        workoutLimit: null,
      };
      queryClient.setQueryData(["user-subscription", "u-1"], {
        ...freeSub(3),
        tierName: "premium",
        workoutLimit: null,
      });
    });

    await waitFor(
      () => {
        expect(storage.getBlockedEntries()).toHaveLength(0);
      },
      { timeout: 5_000 },
    );
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("is a no-op when the user is not signed in", () => {
    const { adapters } = makeAdapters();
    renderHook(() => useAutoRetryOnWorkoutLimitResolved(), {
      wrapper: wrapper(adapters, makeQueryClient()),
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // Mirrors useAutoRetryOnUpgrade's Inspector Brad PR #73 sweep #4
  // high-severity find: a transition arriving mid-flush must not be
  // silently dropped — it has to be recovered once the in-flight flush
  // completes.
  it("flip-flop mid-flush: a resolve that arrives while a previous flush is in flight is recovered once it completes", async () => {
    const { adapters, storage, api, auth } = makeAdapters();
    signIn(auth);
    api.mySubscription = freeSub(3);
    setWorkoutCount(storage, "u-1", 4, 3);
    const entryId = enqueueBlockedWorkoutLimitExceeded(storage);

    let resolveFlush:
      | ((v: { ok: true; json: () => Promise<unknown> }) => void)
      | null = null;
    mockFetch.mockImplementation(
      () =>
        new Promise((res) => {
          resolveFlush = res;
        }),
    );

    renderHook(() => useAutoRetryOnWorkoutLimitResolved(), {
      wrapper: wrapper(adapters, makeQueryClient()),
    });
    await waitFor(() => expect(api.mySubscription).toBeDefined());
    await new Promise((r) => setTimeout(r, 10));

    // T1: resolve via deletion — unblocks and kicks off the flush (hangs).
    act(() => setWorkoutCount(storage, "u-1", 3, 3));
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    expect(
      storage.getBlockedEntries().find((e) => e.id === entryId),
    ).toBeUndefined();

    // T2: back over-limit (e.g. a second device recorded another session)
    // while T1's flush is still hanging.
    act(() => setWorkoutCount(storage, "u-1", 4, 3));
    await new Promise((r) => setTimeout(r, 10));

    // T3: resolved again, still mid-flight — this is the transition that
    // must be recovered once the flush completes.
    const secondBlockedId = enqueueBlockedWorkoutLimitExceeded(storage);
    act(() => setWorkoutCount(storage, "u-1", 3, 3));
    await new Promise((r) => setTimeout(r, 10));
    // Still blocked — the IIFE is still hanging on the T1 fetch.
    expect(
      storage.getBlockedEntries().find((e) => e.id === secondBlockedId),
    ).toBeDefined();

    resolveFlush!({ ok: true, json: async () => ({}) });

    await waitFor(() => {
      expect(storage.getBlockedEntries()).toHaveLength(0);
    });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
