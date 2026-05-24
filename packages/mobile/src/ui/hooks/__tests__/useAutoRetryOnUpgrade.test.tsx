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
    tierName: "basic",
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
    currentTier: "basic",
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
    const { adapters, storage, api, auth } = makeAdapters();
    signIn(auth);
    api.mySubscription = makeSub({ tierName: "basic" });
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

    // Upgrade — flip the cached subscription tier and trigger a re-render.
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

  it("does NOT unblock when the new tier doesn't satisfy the verdict's upgradeTo", async () => {
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

    // Free → basic. Verdict required premium → still blocked.
    queryClient.setQueryData(
      ["user-subscription", "u-1"],
      makeSub({ tierName: "basic" }),
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
      makeSub({ tierName: "individual_trainer_pro", isTrainerTier: true }),
    );
    rerender(undefined);

    await new Promise((r) => setTimeout(r, 10));
    expect(storage.getBlockedEntries()).toHaveLength(1);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("upgradeTo:null verdicts (already top tier) are never auto-unblocked", async () => {
    const { adapters, storage, api, auth } = makeAdapters();
    signIn(auth);
    api.mySubscription = makeSub({ tierName: "basic" });
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
      currentTier: "individual_trainer_pro",
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
});
