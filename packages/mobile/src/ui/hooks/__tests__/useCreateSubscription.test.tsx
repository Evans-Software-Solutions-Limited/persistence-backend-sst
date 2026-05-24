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
import { useCreateSubscription } from "@/ui/hooks/useCreateSubscription";

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

describe("useCreateSubscription", () => {
  it("resolves with the M10 result shape on success", async () => {
    const { adapters, api } = makeAdapters();
    const { result } = renderHook(() => useCreateSubscription(), {
      wrapper: wrapper(adapters, makeQueryClient()),
    });
    await result.current.mutateAsync({
      tierName: "premium",
      billingCycle: "monthly",
      paymentMethodId: "pm_test",
      useTrial: true,
    });
    expect(api.createSubscriptionCalls).toBe(1);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.subscriptionId).toBe("us_test_1");
    expect(result.current.data?.changeType).toBe("new");
  });

  it("surfaces an api error when the call rejects", async () => {
    const { adapters, api } = makeAdapters();
    api.shouldFail = true;
    const { result } = renderHook(() => useCreateSubscription(), {
      wrapper: wrapper(adapters, makeQueryClient()),
    });
    await expect(
      result.current.mutateAsync({
        tierName: "premium",
        billingCycle: "monthly",
        paymentMethodId: "pm_test",
        useTrial: false,
      }),
    ).rejects.toMatchObject({ kind: "api" });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it("invalidates the user-subscription / user-profile / profile-data caches on success", async () => {
    const { adapters } = makeAdapters();
    const queryClient = makeQueryClient();
    const spy = jest.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useCreateSubscription(), {
      wrapper: wrapper(adapters, queryClient),
    });
    await result.current.mutateAsync({
      tierName: "basic",
      billingCycle: "monthly",
      useTrial: false,
    });
    const keys = spy.mock.calls.map((call) => call[0]?.queryKey);
    expect(keys).toEqual(
      expect.arrayContaining([
        ["user-subscription"],
        ["user-profile"],
        ["profile-data"],
      ]),
    );
  });

  it("passes camelCase input through to the adapter unchanged", async () => {
    const { adapters, api } = makeAdapters();
    const { result } = renderHook(() => useCreateSubscription(), {
      wrapper: wrapper(adapters, makeQueryClient()),
    });
    await result.current.mutateAsync({
      tierName: "individual_trainer_pro",
      billingCycle: "yearly",
      paymentMethodId: "pm_train",
      useTrial: true,
      platform: "ios",
    });
    expect(api.lastCreateSubscriptionInput).toEqual({
      tierName: "individual_trainer_pro",
      billingCycle: "yearly",
      paymentMethodId: "pm_train",
      useTrial: true,
      platform: "ios",
    });
  });
});
