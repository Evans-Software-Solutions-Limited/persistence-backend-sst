import { renderHook, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// Mock the API base URL helper — the hook reads it before calling
// processSyncQueue, and the adapter file throws if EXPO_PUBLIC_API_URL
// isn't set in the test env.
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
import { MockPaymentsAdapter } from "@/adapters/payments/__tests__/mock.adapter";
// eslint-disable-next-line import/first
import { InMemoryNetInfoAdapter } from "@/adapters/netInfo/__tests__/InMemoryNetInfoAdapter";
// eslint-disable-next-line import/first
import type { MySubscription } from "@/domain/models/subscription";
// eslint-disable-next-line import/first
import type { Adapters } from "@/shared/types";
// eslint-disable-next-line import/first
import { AdapterProvider } from "@/ui/hooks/useAdapters";
// eslint-disable-next-line import/first
import { useAutoRetryOnUpgrade } from "@/ui/hooks/useAutoRetryOnUpgrade";

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
    payments: new MockPaymentsAdapter(),
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

function makeSub(overrides: Partial<MySubscription> = {}): MySubscription {
  return {
    subscriptionId: "us_1",
    tierName: "premium",
    paymentStatus: "active",
    billingCycle: "monthly",
    startsAt: "2026-01-01T00:00:00.000Z",
    expiresAt: "2030-01-01T00:00:00.000Z",
    cancelledAt: null,
    trialEndsAt: null,
    externalSubscriptionId: "sub_1",
    tierDisplayName: "Basic",
    tierDescription: null,
    workoutLimit: 10,
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
    ...overrides,
  };
}

function enqueueBlocked(
  storage: InMemoryStorageAdapter,
  upgradeTo: MySubscription["tierName"],
) {
  storage.enqueueMutation({
    entityType: "workout",
    operation: "create",
    payload: {},
    endpoint: "/workouts",
    method: "POST",
  });
  const id = storage.getPendingMutations().slice(-1)[0].id;
  storage.markMutationBlocked(id, {
    feature: "create_workout",
    currentTier: "premium",
    upgradeTo,
    upgradePriceMonthly: 12.99,
    blockedAt: "2026-05-24T10:00:00.000Z",
  });
  return id;
}

describe("useAutoRetryOnUpgrade", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
    jest.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("does nothing on first render even with blocked entries (seed-not-trigger)", async () => {
    const { adapters, storage, api, auth } = makeAdapters();
    signIn(auth);
    api.mySubscription = makeSub({ tierName: "premium" });
    enqueueBlocked(storage, "premium");

    renderHook(() => useAutoRetryOnUpgrade(), {
      wrapper: wrapper(adapters, makeQueryClient()),
    });

    // Let the subscription query settle.
    await waitFor(() => expect(api.mySubscription).toBeDefined());
    // The first observation seeds the ref; we don't auto-flush blocked
    // entries simply because the hook just mounted on premium.
    expect(storage.getBlockedEntries()).toHaveLength(1);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("unblocks matching entries and triggers a flush on tier upgrade", async () => {
    // Post tier-simplification: user-track upgrade is free → premium.
    const { adapters, storage, api, auth } = makeAdapters();
    signIn(auth);
    api.mySubscription = makeSub({ tierName: "free" });
    enqueueBlocked(storage, "premium");

    const queryClient = makeQueryClient();
    const { rerender } = renderHook(() => useAutoRetryOnUpgrade(), {
      wrapper: wrapper(adapters, queryClient),
    });

    await waitFor(() =>
      expect(
        queryClient.getQueryData(["user-subscription", "u-1"]),
      ).toBeDefined(),
    );

    // Simulate the server returning success for the re-flushed POST.
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });

    // Upgrade free → premium — satisfies the verdict's required tier.
    queryClient.setQueryData(
      ["user-subscription", "u-1"],
      makeSub({ tierName: "premium" }),
    );
    rerender(undefined);

    await waitFor(() => {
      expect(storage.getBlockedEntries()).toHaveLength(0);
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("does NOT unblock when the new tier doesn't satisfy the verdict's upgradeTo (cross-track)", async () => {
    // Cross-track: user-track tier (premium) does not satisfy a
    // trainer-tier requirement. AC 12.7.
    const { adapters, storage, api, auth } = makeAdapters();
    signIn(auth);
    api.mySubscription = makeSub({ tierName: "free" });
    enqueueBlocked(storage, "individual_trainer");

    const queryClient = makeQueryClient();
    const { rerender } = renderHook(() => useAutoRetryOnUpgrade(), {
      wrapper: wrapper(adapters, queryClient),
    });
    await waitFor(() =>
      expect(
        queryClient.getQueryData(["user-subscription", "u-1"]),
      ).toBeDefined(),
    );

    // Upgrade to premium (user track) — does NOT satisfy the
    // trainer-track verdict requirement.
    queryClient.setQueryData(
      ["user-subscription", "u-1"],
      makeSub({ tierName: "premium" }),
    );
    rerender(undefined);

    // Give the effect a tick.
    await new Promise((r) => setTimeout(r, 10));
    expect(storage.getBlockedEntries()).toHaveLength(1);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("cross-track tier change does not unblock (free → trainer_pro doesn't unblock user-tier requirement)", async () => {
    const { adapters, storage, api, auth } = makeAdapters();
    signIn(auth);
    api.mySubscription = makeSub({ tierName: "free" });
    enqueueBlocked(storage, "premium"); // user-tier requirement

    const queryClient = makeQueryClient();
    const { rerender } = renderHook(() => useAutoRetryOnUpgrade(), {
      wrapper: wrapper(adapters, queryClient),
    });
    await waitFor(() =>
      expect(
        queryClient.getQueryData(["user-subscription", "u-1"]),
      ).toBeDefined(),
    );

    queryClient.setQueryData(
      ["user-subscription", "u-1"],
      makeSub({ tierName: "individual_trainer", isTrainerTier: true }),
    );
    rerender(undefined);

    await new Promise((r) => setTimeout(r, 10));
    expect(storage.getBlockedEntries()).toHaveLength(1);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("upgradeTo:null verdicts (already top tier) are never auto-unblocked", async () => {
    const { adapters, storage, api, auth } = makeAdapters();
    signIn(auth);
    api.mySubscription = makeSub({ tierName: "premium" });
    storage.enqueueMutation({
      entityType: "workout",
      operation: "create",
      payload: {},
      endpoint: "/workouts",
      method: "POST",
    });
    const id = storage.getPendingMutations()[0].id;
    storage.markMutationBlocked(id, {
      feature: "trainer_clients",
      currentTier: "individual_trainer",
      upgradeTo: null,
      upgradePriceMonthly: null,
      blockedAt: "2026-05-24T10:00:00.000Z",
    });

    const queryClient = makeQueryClient();
    const { rerender } = renderHook(() => useAutoRetryOnUpgrade(), {
      wrapper: wrapper(adapters, queryClient),
    });
    await waitFor(() =>
      expect(
        queryClient.getQueryData(["user-subscription", "u-1"]),
      ).toBeDefined(),
    );

    queryClient.setQueryData(
      ["user-subscription", "u-1"],
      makeSub({ tierName: "premium" }),
    );
    rerender(undefined);

    await new Promise((r) => setTimeout(r, 10));
    expect(storage.getBlockedEntries()).toHaveLength(1);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("is a no-op when the user is not signed in", () => {
    const { adapters } = makeAdapters();
    renderHook(() => useAutoRetryOnUpgrade(), {
      wrapper: wrapper(adapters, makeQueryClient()),
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // Inspector Brad PR #73 sweep #4 high-severity find. Sweep #3 moved
  // lastTierRef bump after the processingRef guard so the ref stayed
  // honest — but the effect never re-fired (ref change ≠ re-render),
  // so a transition arriving mid-flight was silently dropped. Sweep
  // #4 fix: bump recheckTick state in the IIFE's finally to force
  // a re-render that processes the missed transition.
  it("flip-flop mid-flush: second transition is recovered after the in-flight flush completes", async () => {
    const { adapters, storage, api, auth } = makeAdapters();
    signIn(auth);
    api.mySubscription = makeSub({ tierName: "free" });

    // Two blocked entries: one will unblock on premium, the other on
    // individual_trainer. The fix only matters when the FIRST tier
    // change actually triggers a flush (matching length > 0); a
    // matching=[] early-return wouldn't keep the IIFE awaiting fetch.
    const premiumEntryId = enqueueBlocked(storage, "premium");
    enqueueBlocked(storage, "individual_trainer");

    // Make fetch hang until we resolve it manually — simulates a real
    // network flush mid-flight.
    let resolveFlush:
      | ((v: {
          ok: true;
          status: 200;
          text: () => Promise<string>;
          json: () => Promise<unknown>;
        }) => void)
      | null = null;
    mockFetch.mockImplementation(
      () =>
        new Promise((res) => {
          resolveFlush = res;
        }),
    );

    const queryClient = makeQueryClient();
    const { rerender } = renderHook(() => useAutoRetryOnUpgrade(), {
      wrapper: wrapper(adapters, queryClient),
    });
    await waitFor(() =>
      expect(
        queryClient.getQueryData(["user-subscription", "u-1"]),
      ).toBeDefined(),
    );

    // T1: free → premium. tierSatisfies("premium", "premium")===true, so
    // the premium entry gets unblocked and the flush kicks off (and hangs).
    queryClient.setQueryData(
      ["user-subscription", "u-1"],
      makeSub({ tierName: "premium" }),
    );
    rerender(undefined);
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    // The premium entry was already unblocked synchronously; the trainer
    // entry stays blocked because premium doesn't satisfy trainer-tier.
    expect(
      storage.getBlockedEntries().find((e) => e.id === premiumEntryId),
    ).toBeUndefined();
    expect(storage.getBlockedEntries()).toHaveLength(1);

    // T2: premium → individual_trainer arrives WHILE the T1 flush is
    // still hanging. Pre-fix: guarded out + lastTierRef bumped (sweep
    // #2) OR guarded out + lastTierRef preserved but no re-fire (sweep
    // #3). Post-sweep-#4: guarded out, pendingRecheckRef=true.
    queryClient.setQueryData(
      ["user-subscription", "u-1"],
      makeSub({ tierName: "individual_trainer", isTrainerTier: true }),
    );
    rerender(undefined);

    // Trainer entry still blocked — IIFE is still hanging on fetch.
    await new Promise((r) => setTimeout(r, 10));
    expect(storage.getBlockedEntries()).toHaveLength(1);

    // Resolve the in-flight flush. finally fires: processingRef=false,
    // pendingRecheckRef===true → setRecheckTick(1) → re-render → effect
    // re-runs → unblock the trainer entry → second flush fires.
    resolveFlush!({
      ok: true,
      status: 200,
      text: async () => "",
      json: async () => ({}),
    });

    await waitFor(() => {
      expect(storage.getBlockedEntries()).toHaveLength(0);
    });
    // T1 flush + the recovered T2 flush = 2 fetches.
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
