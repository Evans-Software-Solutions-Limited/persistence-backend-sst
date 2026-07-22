import { renderHook, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryAuthAdapter } from "@/adapters/auth/__tests__/in-memory-auth.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import { StubHealthAdapter } from "@/adapters/health";
import { StubNotificationsAdapter } from "@/adapters/notifications";
import { MockPaymentsAdapter } from "@/adapters/payments/__tests__/mock.adapter";
import { InMemoryNetInfoAdapter } from "@/adapters/netInfo/__tests__/InMemoryNetInfoAdapter";
import type { MySubscription } from "@/domain/models/subscription";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import { useSyncSubscription } from "@/ui/hooks/useSyncSubscription";

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

function makeAdapters(): { adapters: Adapters; api: InMemoryApiAdapter } {
  const api = new InMemoryApiAdapter();
  const adapters: Adapters = {
    api,
    auth: new InMemoryAuthAdapter(),
    storage: new InMemoryStorageAdapter(),
    health: new StubHealthAdapter(),
    notifications: new StubNotificationsAdapter(),
    payments: new MockPaymentsAdapter(),
    netInfo: new InMemoryNetInfoAdapter(),
  };
  return { adapters, api };
}

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function premiumSub(): MySubscription {
  return {
    subscriptionId: "us-1",
    tierName: "premium",
    paymentStatus: "active",
    billingCycle: "monthly",
    startsAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    cancelledAt: null,
    trialEndsAt: null,
    externalSubscriptionId: "rc_u-1",
    tierDisplayName: "Premium",
    tierDescription: null,
    workoutLimit: null,
    aiAccess: true,
    aiWorkoutLimit: 6,
    gymBuddyAccess: true,
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

describe("useSyncSubscription", () => {
  it("resolves with the confirmed subscription on success", async () => {
    const { adapters, api } = makeAdapters();
    api.nextSyncSubscriptionResult = premiumSub();
    const { result } = renderHook(() => useSyncSubscription(), {
      wrapper: wrapper(adapters, makeQueryClient()),
    });
    const sub = await result.current.mutateAsync();
    expect(api.syncSubscriptionCalls).toBe(1);
    expect(sub.tierName).toBe("premium");
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it("surfaces an api error when the sync call rejects (e.g. 502 subscription_sync_failed)", async () => {
    const { adapters, api } = makeAdapters();
    api.nextSyncSubscriptionError = {
      kind: "api",
      code: "server",
      message: "subscription_sync_failed",
      status: 502,
    };
    const { result } = renderHook(() => useSyncSubscription(), {
      wrapper: wrapper(adapters, makeQueryClient()),
    });
    await expect(result.current.mutateAsync()).rejects.toMatchObject({
      kind: "api",
      message: "subscription_sync_failed",
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it("invalidates the user-subscription / user-profile / profile-data caches on success", async () => {
    const { adapters, api } = makeAdapters();
    api.nextSyncSubscriptionResult = premiumSub();
    const queryClient = makeQueryClient();
    const spy = jest.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useSyncSubscription(), {
      wrapper: wrapper(adapters, queryClient),
    });
    await result.current.mutateAsync();
    const keys = spy.mock.calls.map((call) => call[0]?.queryKey);
    expect(keys).toEqual(
      expect.arrayContaining([
        ["user-subscription"],
        ["user-profile"],
        ["profile-data"],
      ]),
    );
  });
});
