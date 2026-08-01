import { renderHook, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn(), replace: jest.fn() }),
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
import type {
  MySubscription,
  SubscriptionTier,
} from "@/domain/models/subscription";
// eslint-disable-next-line import/first
import type { Adapters } from "@/shared/types";
// eslint-disable-next-line import/first
import { AdapterProvider } from "@/ui/hooks/useAdapters";
// eslint-disable-next-line import/first
import { useNutritionAiGate } from "@/ui/hooks/useNutritionAiGate";

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
    netInfo: new InMemoryNetInfoAdapter(),
  };
  return { adapters, api, auth };
}

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

const TIER: SubscriptionTier = {
  tierName: "premium",
  displayName: "Premium",
  description: null,
  priceMonthly: 12.99,
  priceYearly: 129.99,
  currency: "GBP",
  features: {},
  workoutLimit: null,
  aiAccess: true,
  aiWorkoutLimit: 0,
  gymBuddyAccess: true,
  trainerClientLimit: null,
  isTrainerTier: false,
  analyticsAccess: false,
  exportAccess: false,
  stripePriceIdMonthly: null,
  stripePriceIdYearly: null,
};

function makeSub(overrides: Partial<MySubscription> = {}): MySubscription {
  return {
    subscriptionId: "us_1",
    tierName: "premium",
    paymentStatus: "active",
    billingCycle: "monthly",
    startsAt: "2026-01-01T00:00:00.000Z",
    expiresAt: null,
    cancelledAt: null,
    trialEndsAt: null,
    externalSubscriptionId: null,
    tierDisplayName: "Premium",
    tierDescription: null,
    workoutLimit: null,
    aiAccess: true,
    aiWorkoutLimit: 0,
    gymBuddyAccess: true,
    trainerClientLimit: null,
    isTrainerTier: false,
    role: "user",
    hasUsedUserTrial: false,
    hasUsedTrainerTrial: false,
    isEligibleForUserTrial: false,
    isEligibleForTrainerTrial: false,
    scheduledChange: null,
    ...overrides,
  };
}

/**
 * `useNutritionAiGate` is a thin `useFeatureGate("ai_access", enabled)`
 * wrapper — this is what pulls `/subscription-tiers` + `/subscriptions/me`
 * into the launch fan-out for the always-mounted QuickAdd/AddRecipe sheets,
 * so its `enabled` forwarding is worth its own direct test (the container
 * suites mock this hook entirely, so they don't exercise the real
 * implementation).
 */
describe("useNutritionAiGate", () => {
  it("defaults to enabled: fetches and resolves a real verdict", async () => {
    const { adapters, api, auth } = makeAdapters();
    auth.currentSession = {
      accessToken: "tok",
      refreshToken: "rtok",
      userId: "u-1",
      email: "x@y.com",
      expiresAt: Date.now() + 3600_000,
    };
    api.mySubscription = makeSub();
    api.subscriptionTiers = [TIER];

    const { result } = renderHook(() => useNutritionAiGate(), {
      wrapper: wrapper(adapters, makeQueryClient()),
    });
    await waitFor(() => expect(result.current.allowed).toBe(true));
  });

  // Inspector Brad finding (reverted): `useSubscriptionTiers` must stay
  // UNGATED regardless of `enabled` — it's cheap, user-invariant, and
  // TanStack-deduped, so gating it left the upgrade prompt's price missing
  // until the round trip that only starts once the sheet opens. Only
  // `useMySubscription` is gated.
  it("`enabled=false` withholds mySubscription but subscription-tiers still fires; flipping true resolves the verdict", async () => {
    const { adapters, api, auth } = makeAdapters();
    auth.currentSession = {
      accessToken: "tok",
      refreshToken: "rtok",
      userId: "u-1",
      email: "x@y.com",
      expiresAt: Date.now() + 3600_000,
    };
    api.mySubscription = makeSub();
    api.subscriptionTiers = [TIER];
    const getSubscriptionTiersSpy = jest.spyOn(api, "getSubscriptionTiers");
    const getMySubscriptionSpy = jest.spyOn(api, "getMySubscription");

    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useNutritionAiGate(enabled),
      {
        initialProps: { enabled: false },
        wrapper: wrapper(adapters, makeQueryClient()),
      },
    );
    expect(result.current.allowed).toBe(false);
    await waitFor(() => expect(getSubscriptionTiersSpy).toHaveBeenCalled());
    expect(getMySubscriptionSpy).not.toHaveBeenCalled();
    expect(result.current.reason).toBe("unknown");

    rerender({ enabled: true });
    await waitFor(() => expect(result.current.allowed).toBe(true));
  });
});
