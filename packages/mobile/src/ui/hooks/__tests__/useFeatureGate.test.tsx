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
    netInfo: new InMemoryNetInfoAdapter(),
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

const PREMIUM_TIER: SubscriptionTier = {
  tierName: "premium",
  displayName: "Premium",
  description: null,
  priceMonthly: 12.99,
  priceYearly: 129.99,
  currency: "GBP",
  features: { gym_buddy: true, progress: true },
  workoutLimit: null,
  aiAccess: true,
  aiWorkoutLimit: 6,
  gymBuddyAccess: true,
  trainerClientLimit: null,
  isTrainerTier: false,
  analyticsAccess: false,
  exportAccess: false,
  stripePriceIdMonthly: "price_premium_m",
  stripePriceIdYearly: "price_premium_y",
};

// BASIC_TIER alias retained for legacy test sites that still pass it
// in the tiers array. Post tier-simplification the catalog contains
// only Premium + 3 trainer tiers; tests should migrate to PREMIUM_TIER
// directly but the alias keeps the fixture list non-empty.
const BASIC_TIER: SubscriptionTier = PREMIUM_TIER;

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
      makeSub({ tierName: "premium", workoutLimit: 10 }),
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

  it("create_workout: cancelled status with PAST expiresAt → denied with reason 'cancelled'", () => {
    const verdict = computeFeatureGateVerdict(
      "create_workout",
      makeSub({
        tierName: "premium",
        paymentStatus: "cancelled",
        workoutLimit: 10,
        expiresAt: new Date(Date.now() - 86_400_000).toISOString(), // -1 day
      }),
    );
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toBe("cancelled");
  });

  it("create_workout: cancelled status with FUTURE expiresAt → allowed (server mirrors this; Inspector Brad PR #72 low-severity find — sweep #2)", () => {
    // Regression: previously, `!isActive` returned a `cancelled` deny
    // regardless of `expiresAt`. The server's `classifySubscriptionStatus`
    // treats cancelled-with-future-expiresAt as still entitled (the user
    // paid through that date). Without this fix, mobile would render
    // a paywall during the paid-through window while the server cheerfully
    // accepted the mutations — a divergence that becomes user-visible
    // the moment Wave 2 wires `useFeatureGate` into screen-render guards.
    const verdict = computeFeatureGateVerdict(
      "create_workout",
      makeSub({
        tierName: "premium",
        paymentStatus: "cancelled",
        workoutLimit: 10,
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(), // +1 day
      }),
    );
    expect(verdict.allowed).toBe(true);
  });

  it("ai_workout: cancelled with FUTURE expiresAt + aiAccess → allowed (mirrors server)", () => {
    const verdict = computeFeatureGateVerdict(
      "ai_workout",
      makeSub({
        tierName: "premium",
        paymentStatus: "cancelled",
        aiAccess: true,
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      }),
    );
    expect(verdict.allowed).toBe(true);
  });

  it("create_workout: trialing status with non-zero limit → allowed", () => {
    const verdict = computeFeatureGateVerdict(
      "create_workout",
      makeSub({
        tierName: "premium",
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
        tierName: "premium",
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
        tierName: "premium",
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

  it("ai_workout: past_due (non-active, non-cancelled) → denied with reason 'tier'", () => {
    // Anti-regression: the cancelled vs tier branch in ai_workout was
    // previously only exercised through the cancelled side. Past-due
    // covers the !isActive && !isCancelled branch.
    const verdict = computeFeatureGateVerdict(
      "ai_workout",
      makeSub({
        tierName: "premium",
        paymentStatus: "past_due",
        aiAccess: true,
      }),
    );
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toBe("tier");
  });

  // M9.5 Tier B nutrition AI (Snap / free-text estimation) — `ai_access` is a
  // distinct feature key from `ai_workout` but shares identical gate logic
  // (specs/13-nutrition-tracking/design.md § Revised 2026-07-03).
  it("ai_access: active + aiAccess=true → allowed", () => {
    const verdict = computeFeatureGateVerdict(
      "ai_access",
      makeSub({ tierName: "premium", aiAccess: true }),
    );
    expect(verdict.allowed).toBe(true);
  });

  it("ai_access: trialing + aiAccess=true → allowed (trial users count)", () => {
    const verdict = computeFeatureGateVerdict(
      "ai_access",
      makeSub({
        tierName: "premium",
        paymentStatus: "trialing",
        aiAccess: true,
      }),
    );
    expect(verdict.allowed).toBe(true);
  });

  it("ai_access: free tier (aiAccess=false) → denied", () => {
    const verdict = computeFeatureGateVerdict("ai_access", makeSub());
    expect(verdict.allowed).toBe(false);
  });

  it("ai_access: cancelled → denied with reason 'cancelled'", () => {
    const verdict = computeFeatureGateVerdict(
      "ai_access",
      makeSub({
        tierName: "premium",
        paymentStatus: "cancelled",
        aiAccess: true,
      }),
    );
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toBe("cancelled");
  });

  it("ai_access: cancelled with FUTURE expiresAt + aiAccess → allowed (mirrors server)", () => {
    const verdict = computeFeatureGateVerdict(
      "ai_access",
      makeSub({
        tierName: "premium",
        paymentStatus: "cancelled",
        aiAccess: true,
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      }),
    );
    expect(verdict.allowed).toBe(true);
  });

  it("ai_access: past_due (non-active, non-cancelled) → denied with reason 'tier'", () => {
    const verdict = computeFeatureGateVerdict(
      "ai_access",
      makeSub({
        tierName: "premium",
        paymentStatus: "past_due",
        aiAccess: true,
      }),
    );
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toBe("tier");
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
        tierName: "individual_trainer",
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
      // Post tier-simplification: upgrade target is premium (£12.99),
      // not the dropped basic (£4.99).
      expect(result.current.gateProps.upgradePriceMonthly).toBe(12.99),
    );
    expect(result.current.allowed).toBe(false);
    expect(result.current.gateProps.currentTier).toBe("free");
    expect(result.current.gateProps.upgradeTo).toBe("premium");
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
    // Post tier-simplification: free → premium is the only user-track
    // upgrade. Free user hits gym_buddy gate (premium feature) → upgrade
    // target is premium, billing cycle defaults to monthly.
    const { adapters, api, auth } = makeAdapters();
    signIn(auth);
    api.mySubscription = makeSub({
      tierName: "free",
      paymentStatus: "active",
      billingCycle: "yearly",
      workoutLimit: 0,
      aiAccess: false,
      gymBuddyAccess: false,
    });
    api.subscriptionTiers = [PREMIUM_TIER];

    const { result } = renderHook(() => useFeatureGate("gym_buddy"), {
      wrapper: wrapper(adapters, makeQueryClient()),
    });

    await waitFor(() =>
      expect(result.current.gateProps.currentTier).toBe("free"),
    );
    await waitFor(() =>
      expect(result.current.gateProps.upgradePriceMonthly).toBe(12.99),
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
      expect(result.current.gateProps.upgradeTo).toBe("premium"),
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
    // upgradeTo="premium") and miss the top-tier-terminal branch entirely.
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
      expect(result.current.gateProps.upgradeTo).toBe("premium"),
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
    expect(mockPush.mock.calls[0][0]).toContain("tier=premium");
    expect(mockPush.mock.calls[0][0]).toContain("cycle=monthly");
  });

  // Inspector Brad PR #73 high-severity find — sweep #3. Pre-fix, a free
  // user denied on `trainer_clients` saw upgradeTo="premium", paid £12.99,
  // came back to the SAME paywall (because Premium has isTrainerTier=false).
  // Fix made resolveUpgradeTarget feature-aware so trainer-only features
  // route to the cheapest trainer tier (individual_trainer).
  it("trainer_clients on a free user routes upgrade to individual_trainer, not premium", async () => {
    const { adapters, api, auth } = makeAdapters();
    signIn(auth);
    api.mySubscription = makeSub(); // free tier
    api.subscriptionTiers = [PREMIUM_TIER];

    const { result } = renderHook(() => useFeatureGate("trainer_clients"), {
      wrapper: wrapper(adapters, makeQueryClient()),
    });

    await waitFor(() =>
      expect(result.current.gateProps.currentTier).toBe("free"),
    );
    expect(result.current.allowed).toBe(false);
    expect(result.current.gateProps.upgradeTo).toBe("individual_trainer");

    act(() => {
      result.current.gateProps.onUpgrade();
    });
    expect(mockPush.mock.calls[0][0]).toContain("tier=individual_trainer");
  });

  it("trainer_clients fallback (pre-cache) also routes to individual_trainer, not premium", () => {
    const { adapters } = makeAdapters();
    const { result } = renderHook(() => useFeatureGate("trainer_clients"), {
      wrapper: wrapper(adapters, makeQueryClient()),
    });
    expect(result.current.gateProps.upgradeTo).toBe("individual_trainer");
    act(() => {
      result.current.gateProps.onUpgrade();
    });
    expect(mockPush.mock.calls[0][0]).toContain("tier=individual_trainer");
  });

  it("trainer_clients on a user already on a trainer tier returns upgradeTo=null (no sideways switch)", async () => {
    const { adapters, api, auth } = makeAdapters();
    signIn(auth);
    // Contrived: trainer tier but isTrainerTier flag flipped false. In
    // practice a trainer tier always has isTrainerTier=true so this branch
    // is defensive; the assertion proves we don't suggest a sideways switch
    // to another trainer tier when they're already on one.
    api.mySubscription = makeSub({
      tierName: "small_business",
      isTrainerTier: false,
    });
    api.subscriptionTiers = [PREMIUM_TIER];

    const { result } = renderHook(() => useFeatureGate("trainer_clients"), {
      wrapper: wrapper(adapters, makeQueryClient()),
    });

    await waitFor(() =>
      expect(result.current.gateProps.currentTier).toBe("small_business"),
    );
    expect(result.current.gateProps.upgradeTo).toBeNull();
  });
});
