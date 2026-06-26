import { render, screen, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryAuthAdapter } from "@/adapters/auth/__tests__/in-memory-auth.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import { StubHealthAdapter } from "@/adapters/health";
import { StubNotificationsAdapter } from "@/adapters/notifications";
import { MockPaymentsAdapter } from "@/adapters/payments/__tests__/mock.adapter";
import { MockPurchasesAdapter } from "@/adapters/purchases/__tests__/mock.adapter";
import { InMemoryNetInfoAdapter } from "@/adapters/netInfo/__tests__/InMemoryNetInfoAdapter";
import type {
  MySubscription,
  SubscriptionTier,
} from "@/domain/models/subscription";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import { SubscriptionSelectionContainer } from "@/ui/containers/SubscriptionSelectionContainer";

// jest-expo defaults Platform.OS to "ios"; the dispatcher therefore selects
// the RevenueCat rail whenever a purchases adapter is present.
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
  useLocalSearchParams: () => ({}),
}));

const PREMIUM: SubscriptionTier = {
  tierName: "premium",
  displayName: "Premium",
  description: null,
  priceMonthly: 9.99,
  priceYearly: 99.99,
  currency: "GBP",
  features: {},
  workoutLimit: null,
  aiAccess: true,
  aiWorkoutLimit: 6,
  gymBuddyAccess: true,
  trainerClientLimit: null,
  isTrainerTier: false,
  analyticsAccess: false,
  exportAccess: false,
  stripePriceIdMonthly: "price_m",
  stripePriceIdYearly: "price_y",
};

function freeSub(): MySubscription {
  return {
    subscriptionId: null,
    tierName: "free",
    paymentStatus: "active",
    billingCycle: null,
    startsAt: new Date().toISOString(),
    expiresAt: null,
    cancelledAt: null,
    trialEndsAt: null,
    externalSubscriptionId: null,
    tierDisplayName: "Free",
    tierDescription: null,
    workoutLimit: 3,
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

function makeAdapters(withPurchases: boolean): Adapters {
  const api = new InMemoryApiAdapter();
  const auth = new InMemoryAuthAdapter();
  api.subscriptionTiers = [PREMIUM];
  api.mySubscription = freeSub();
  auth.currentSession = {
    accessToken: "tok",
    refreshToken: "rtok",
    userId: "u-1",
    email: "x@y.com",
    expiresAt: Date.now() + 3600_000,
  };
  return {
    api,
    auth,
    storage: new InMemoryStorageAdapter(),
    health: new StubHealthAdapter(),
    notifications: new StubNotificationsAdapter(),
    payments: new MockPaymentsAdapter(),
    netInfo: new InMemoryNetInfoAdapter(),
    purchases: withPurchases ? new MockPurchasesAdapter() : undefined,
  };
}

function renderWith(adapters: Adapters) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <AdapterProvider adapters={adapters}>
        <SubscriptionSelectionContainer />
      </AdapterProvider>
    </QueryClientProvider>,
  );
}

describe("SubscriptionSelectionContainer — rail dispatch", () => {
  it("renders the RevenueCat iOS flow (with a restore CTA, no Stripe path) when a purchases adapter is present", async () => {
    renderWith(makeAdapters(true));
    await waitFor(() =>
      expect(screen.getByTestId("ios-purchase-restore")).toBeTruthy(),
    );
    // The Stripe Apple-Pay path is not reachable on the iOS rail (§3.1.1).
    expect(screen.queryByTestId("cancel-subscription-button")).toBeNull();
  });

  it("falls back to the Stripe flow when no purchases adapter is present", async () => {
    renderWith(makeAdapters(false));
    await waitFor(() =>
      expect(screen.getByTestId("subscription-card-premium")).toBeTruthy(),
    );
    expect(screen.queryByTestId("ios-purchase-restore")).toBeNull();
  });
});
