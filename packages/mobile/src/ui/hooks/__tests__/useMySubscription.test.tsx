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
import {
  USER_SUBSCRIPTION_QUERY_KEY_PREFIX,
  USER_SUBSCRIPTION_STALE_TIME_MS,
  useMySubscription,
  userSubscriptionQueryKey,
} from "@/ui/hooks/useMySubscription";

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
  api: InMemoryApiAdapter;
  auth: InMemoryAuthAdapter;
} {
  const api = new InMemoryApiAdapter();
  const auth = new InMemoryAuthAdapter();
  const adapters: Adapters = {
    api,
    auth,
    storage: new InMemoryStorageAdapter(),
    health: new StubHealthAdapter(),
    notifications: new StubNotificationsAdapter(),
    payments: new MockPaymentsAdapter(),
    netInfo: new InMemoryNetInfoAdapter(),
  };
  return { adapters, api, auth };
}

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

const SAMPLE_SUB: MySubscription = {
  subscriptionId: "us_1",
  tierName: "premium",
  paymentStatus: "active",
  billingCycle: "monthly",
  startsAt: "2026-01-01T00:00:00.000Z",
  expiresAt: "2030-01-01T00:00:00.000Z",
  cancelledAt: null,
  trialEndsAt: null,
  externalSubscriptionId: "sub_test",
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

describe("useMySubscription", () => {
  it("is disabled until the user signs in (no userId)", async () => {
    const { adapters, api } = makeAdapters();
    api.mySubscription = SAMPLE_SUB;
    const { result } = renderHook(() => useMySubscription(), {
      wrapper: wrapper(adapters, makeQueryClient()),
    });
    // With no session, the query should be disabled — never fires.
    expect(result.current.fetchStatus).toBe("idle");
    expect(result.current.data).toBeUndefined();
  });

  it("fetches when the user has signed in", async () => {
    const { adapters, api, auth } = makeAdapters();
    api.mySubscription = SAMPLE_SUB;
    auth.currentSession = {
      accessToken: "tok",
      refreshToken: "rtok",
      userId: "u-1",
      email: "x@y.com",
      expiresAt: Date.now() + 3600_000,
    };
    const { result } = renderHook(() => useMySubscription(), {
      wrapper: wrapper(adapters, makeQueryClient()),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.tierName).toBe("premium");
  });

  it("surfaces an error when the API rejects", async () => {
    const { adapters, api, auth } = makeAdapters();
    api.mySubscription = SAMPLE_SUB;
    api.shouldFail = true;
    auth.currentSession = {
      accessToken: "tok",
      refreshToken: "rtok",
      userId: "u-1",
      email: "x@y.com",
      expiresAt: Date.now() + 3600_000,
    };
    const { result } = renderHook(() => useMySubscription(), {
      wrapper: wrapper(adapters, makeQueryClient()),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.kind).toBe("api");
  });

  it("uses the documented query-key prefix + 2-minute stale-time + helper builder", () => {
    expect(USER_SUBSCRIPTION_QUERY_KEY_PREFIX).toBe("user-subscription");
    expect(USER_SUBSCRIPTION_STALE_TIME_MS).toBe(2 * 60 * 1000);
    expect(userSubscriptionQueryKey("u-42")).toEqual([
      "user-subscription",
      "u-42",
    ]);
  });
});
