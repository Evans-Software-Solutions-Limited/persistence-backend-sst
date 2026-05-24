import { renderHook, waitFor, act } from "@testing-library/react-native";
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
import { MockPaymentsAdapter } from "@/adapters/payments/__tests__/mock.adapter";
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
import {
  computeFeatureGateVerdict,
  useFeatureGate,
} from "@/ui/hooks/useFeatureGate";

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
  };
  return { adapters, api, auth };
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

const BASIC_TIER: SubscriptionTier = {
  tierName: "basic",
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
  stripePriceIdMonthly: "price_basic_m",
  stripePriceIdYearly: "price_basic_y",
};

const PREMIUM_TIER: SubscriptionTier = {
  ...BASIC_TIER,
  tierName: "premium",
  displayName: "Premium",
  priceMonthly: 14.99,
  priceYearly: 149.99,
  workoutLimit: null,
  aiAccess: true,
  aiWorkoutLimit: 6,
  gymBuddyAccess: true,
  stripePriceIdMonthly: "price_premium_m",
  stripePriceIdYearly: "price_premium_y",
};

function makeSub(overrides: Partial<MySubscription> = {}): MySubscription {
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
    workoutLimit: 0,
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

beforeEach(() => {
  mockPush.mockReset();
});

describe("computeFeatureGateVerdict (pure)", () => {
  it("create_workout: free tier with active status but workoutLimit=0 → denied", () => {
    const verdict = computeFeatureGateVerdict("create_workout", makeSub());
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toBe("tier");
  });

  it("create_workout: basic tier with workoutLimit=10 active → allowed", () => {
    const verdict = computeFeatureGateVerdict(
      "create_workout",
      makeSub({ tierName: "basic", workoutLimit: 10 }),
    );
    expect(verdict.allowed).toBe(true);
  });

  it("create_workout: premium with workoutLimit=null (unlimited) → allowed", () => {
    const verdict = computeFeatureGateVerdict(
      "create_workout",
      makeSub({ tierName: "premium", workoutLimit: null, aiAccess: true }),
    );
    expect(verdict.allowed).toBe(true);
  });

  it("create_workout: cancelled status → denied with reason 'cancelled'", () => {
    const verdict = computeFeatureGateVerdict(
      "create_workout",
      makeSub({
        tierName: "basic",
        paymentStatus: "cancelled",
        workoutLimit: 10,
      }),
    );
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toBe("cancelled");
  });

  it("create_workout: trialing status with non-zero limit → allowed", () => {
    const verdict = computeFeatureGateVerdict(
      "create_workout",
      makeSub({
        tierName: "basic",
        paymentStatus: "trialing",
        workoutLimit: 10,
      }),
    );
    expect(verdict.allowed).toBe(true);
  });

  it("create_workout: past_due → denied with reason 'tier'", () => {
    const verdict = computeFeatureGateVerdict(
      "create_workout",
      makeSub({
        tierName: "basic",
        paymentStatus: "past_due",
        workoutLimit: 10,
      }),
    );
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toBe("tier");
  });

  it("ai_workout: active + aiAccess=true → allowed", () => {
    const verdict = computeFeatureGateVerdict(
      "ai_workout",
      makeSub({ tierName: "premium", aiAccess: true }),
    );
    expect(verdict.allowed).toBe(true);
  });

  it("ai_workout: trialing + aiAccess=true → allowed (trial users count)", () => {
    const verdict = computeFeatureGateVerdict(
      "ai_workout",
      makeSub({
        tierName: "basic",
        paymentStatus: "trialing",
        aiAccess: true,
      }),
    );
    expect(verdict.allowed).toBe(true);
  });

  it("ai_workout: free tier (aiAccess=false) → denied", () => {
    const verdict = computeFeatureGateVerdict("ai_workout", makeSub());
    expect(verdict.allowed).toBe(false);
  });

  it("ai_workout: cancelled → denied with reason 'cancelled'", () => {
    const verdict = computeFeatureGateVerdict(
      "ai_workout",
      makeSub({
        tierName: "premium",
        paymentStatus: "cancelled",
        aiAccess: true,
      }),
    );
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toBe("cancelled");
  });

  it("gym_buddy: gymBuddyAccess=true (premium) → allowed", () => {
    const verdict = computeFeatureGateVerdict(
      "gym_buddy",
      makeSub({ tierName: "premium", gymBuddyAccess: true }),
    );
    expect(verdict.allowed).toBe(true);
  });

  it("gym_buddy: gymBuddyAccess=false → denied", () => {
    const verdict = computeFeatureGateVerdict("gym_buddy", makeSub());
    expect(verdict.allowed).toBe(false);
  });

  it("unlimited_exercise_library: stub returns allowed regardless of tier", () => {
    const verdict = computeFeatureGateVerdict(
      "unlimited_exercise_library",
      makeSub(),
    );
    expect(verdict.allowed).toBe(true);
  });

  it("trainer_clients: isTrainerTier=true → allowed", () => {
    const verdict = computeFeatureGateVerdict(
      "trainer_clients",
      makeSub({
        tierName: "individual_trainer_pro",
        isTrainerTier: true,
      }),
    );
    expect(verdict.allowed).toBe(true);
  });

  it("trainer_clients: isTrainerTier=false → denied", () => {
    const verdict = computeFeatureGateVerdict("trainer_clients", makeSub());
    expect(verdict.allowed).toBe(false);
  });
});

describe("useFeatureGate hook", () => {
  it("returns allowed=false reason='unknown' before subscription cache resolves", () => {
    const { adapters } = makeAdapters();
    // No sign-in → useMySubscription never fires → data stays undefined.
    const { result } = renderHook(() => useFeatureGate("create_workout"), {
      wrapper: wrapper(adapters, makeQueryClient()),
    });
    expect(result.current.allowed).toBe(false);
    expect(result.current.reason).toBe("unknown");
    expect(result.current.gateProps.feature).toBe("create_workout");
    expect(result.current.gateProps.currentTier).toBe("free");
  });

  it("computes a denied verdict for create_workout when the cached sub is free-tier", async () => {
    const { adapters, api, auth } = makeAdapters();
    signIn(auth);
    api.mySubscription = makeSub();
    api.subscriptionTiers = [BASIC_TIER, PREMIUM_TIER];

    const { result } = renderHook(() => useFeatureGate("create_workout"), {
      wrapper: wrapper(adapters, makeQueryClient()),
    });

    await waitFor(() => expect(result.current.reason).toBe("tier"));
    await waitFor(() =>
      expect(result.current.gateProps.upgradePriceMonthly).toBe(4.99),
    );
    expect(result.current.allowed).toBe(false);
    expect(result.current.gateProps.currentTier).toBe("free");
    expect(result.current.gateProps.upgradeTo).toBe("basic");
    expect(result.current.gateProps.featureDisplayName).toContain("workout");
  });

  it("computes allowed=true when the cached sub matches the feature requirement", async () => {
    const { adapters, api, auth } = makeAdapters();
    signIn(auth);
    api.mySubscription = makeSub({
      tierName: "premium",
      paymentStatus: "active",
      workoutLimit: null,
      aiAccess: true,
      gymBuddyAccess: true,
    });
    api.subscriptionTiers = [BASIC_TIER, PREMIUM_TIER];

    const { result } = renderHook(() => useFeatureGate("ai_workout"), {
      wrapper: wrapper(adapters, makeQueryClient()),
    });

    await waitFor(() => expect(result.current.allowed).toBe(true));
  });

  it("gateProps.onUpgrade pushes to /(auth)/subscription-selection with tier + cycle query params", async () => {
    const { adapters, api, auth } = makeAdapters();
    signIn(auth);
    api.mySubscription = makeSub({
      tierName: "basic",
      paymentStatus: "active",
      billingCycle: "yearly",
      workoutLimit: 10,
      aiAccess: true,
    });
    api.subscriptionTiers = [BASIC_TIER, PREMIUM_TIER];

    const { result } = renderHook(() => useFeatureGate("gym_buddy"), {
      wrapper: wrapper(adapters, makeQueryClient()),
    });

    // Wait for sub + tier catalog to load. The hook's fallback branch
    // (before useMySubscription resolves) returns currentTier="free"
    // and upgradeTo="basic"; we need to observe the post-resolve state
    // where currentTier="basic" and upgradeTo="premium".
    await waitFor(() =>
      expect(result.current.gateProps.currentTier).toBe("basic"),
    );
    await waitFor(() =>
      expect(result.current.gateProps.upgradePriceMonthly).toBe(14.99),
    );
    expect(result.current.allowed).toBe(false);
    expect(result.current.gateProps.upgradeTo).toBe("premium");

    act(() => {
      result.current.gateProps.onUpgrade();
    });
    expect(mockPush).toHaveBeenCalledTimes(1);
    const pushArg = mockPush.mock.calls[0][0];
    expect(pushArg).toContain("/(auth)/subscription-selection");
    expect(pushArg).toContain("tier=premium");
    expect(pushArg).toContain("cycle=yearly");
  });

  it("onUpgrade defaults to monthly cycle when the sub has no current cycle (free tier)", async () => {
    const { adapters, api, auth } = makeAdapters();
    signIn(auth);
    api.mySubscription = makeSub(); // free tier, billingCycle=null
    api.subscriptionTiers = [BASIC_TIER, PREMIUM_TIER];

    const { result } = renderHook(() => useFeatureGate("create_workout"), {
      wrapper: wrapper(adapters, makeQueryClient()),
    });

    await waitFor(() =>
      expect(result.current.gateProps.upgradeTo).toBe("basic"),
    );

    act(() => {
      result.current.gateProps.onUpgrade();
    });
    expect(mockPush.mock.calls[0][0]).toContain("cycle=monthly");
  });

  it("upgradeTo is null when the user is already on the top user-track tier (premium)", async () => {
    const { adapters, api, auth } = makeAdapters();
    signIn(auth);
    api.mySubscription = makeSub({
      tierName: "premium",
      paymentStatus: "active",
      workoutLimit: null,
      aiAccess: true,
      gymBuddyAccess: false, // contrived: deny gym_buddy so we exercise upgradeTo=null
    });
    api.subscriptionTiers = [BASIC_TIER, PREMIUM_TIER];

    const { result } = renderHook(() => useFeatureGate("gym_buddy"), {
      wrapper: wrapper(adapters, makeQueryClient()),
    });

    // Wait for the sub to actually resolve to premium — otherwise we
    // observe the pre-resolution fallback (currentTier="free",
    // upgradeTo="basic") and miss the top-tier-terminal branch entirely.
    await waitFor(() =>
      expect(result.current.gateProps.currentTier).toBe("premium"),
    );
    expect(result.current.allowed).toBe(false);
    expect(result.current.gateProps.upgradeTo).toBeNull();
    expect(result.current.gateProps.upgradePriceMonthly).toBeNull();

    // onUpgrade is a no-op when there's no upgrade target — router.push
    // must NOT fire (otherwise the gate would surface an empty Selection
    // screen).
    act(() => {
      result.current.gateProps.onUpgrade();
    });
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("upgradePriceMonthly falls back to null when the upgrade target isn't in the cached tier list", async () => {
    const { adapters, api, auth } = makeAdapters();
    signIn(auth);
    api.mySubscription = makeSub();
    // Empty tier catalog — simulates a fresh cold-start where useFeatureGate
    // fires before useSubscriptionTiers resolves.
    api.subscriptionTiers = [];

    const { result } = renderHook(() => useFeatureGate("create_workout"), {
      wrapper: wrapper(adapters, makeQueryClient()),
    });

    await waitFor(() =>
      expect(result.current.gateProps.upgradeTo).toBe("basic"),
    );
    expect(result.current.gateProps.upgradePriceMonthly).toBeNull();
  });

  it("fallback onUpgrade (before subscription cache resolves) still routes with default basic tier", () => {
    const { adapters } = makeAdapters();
    const { result } = renderHook(() => useFeatureGate("ai_workout"), {
      wrapper: wrapper(adapters, makeQueryClient()),
    });
    // No sub → fallback gateProps. Calling onUpgrade should still route
    // (we let the user attempt to subscribe even if cache hasn't filled).
    act(() => {
      result.current.gateProps.onUpgrade();
    });
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush.mock.calls[0][0]).toContain("tier=basic");
    expect(mockPush.mock.calls[0][0]).toContain("cycle=monthly");
  });
});
