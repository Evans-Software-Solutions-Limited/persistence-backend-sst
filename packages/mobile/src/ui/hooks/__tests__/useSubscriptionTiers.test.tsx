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
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import {
  SUBSCRIPTION_TIERS_QUERY_KEY,
  SUBSCRIPTION_TIERS_STALE_TIME_MS,
  useSubscriptionTiers,
} from "@/ui/hooks/useSubscriptionTiers";

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

describe("useSubscriptionTiers", () => {
  it("starts in loading state and resolves to the catalog list", async () => {
    const { adapters, api } = makeAdapters();
    api.subscriptionTiers = [
      {
        tierName: "premium",
        displayName: "Basic",
        description: null,
        priceMonthly: 4.99,
        priceYearly: 49.99,
        currency: "GBP",
        features: {},
        workoutLimit: 10,
        aiAccess: true,
        aiWorkoutLimit: 1,
        gymBuddyAccess: false,
        trainerClientLimit: null,
        isTrainerTier: false,
        analyticsAccess: false,
        exportAccess: false,
        stripePriceIdMonthly: null,
        stripePriceIdYearly: null,
      },
    ];
    const { result } = renderHook(() => useSubscriptionTiers(), {
      wrapper: wrapper(adapters, makeQueryClient()),
    });
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0]?.tierName).toBe("premium");
  });

  it("surfaces an error when the API rejects", async () => {
    const { adapters, api } = makeAdapters();
    api.shouldFail = true;
    const { result } = renderHook(() => useSubscriptionTiers(), {
      wrapper: wrapper(adapters, makeQueryClient()),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.kind).toBe("api");
  });

  it("uses the documented query key + 10-minute stale time", () => {
    expect(SUBSCRIPTION_TIERS_QUERY_KEY).toEqual(["subscription-tiers"]);
    expect(SUBSCRIPTION_TIERS_STALE_TIME_MS).toBe(10 * 60 * 1000);
  });
});
