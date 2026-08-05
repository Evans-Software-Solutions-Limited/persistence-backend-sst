import React from "react";
import { Linking } from "react-native";
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryAuthAdapter } from "@/adapters/auth/__tests__/in-memory-auth.adapter";
import { MockPurchasesAdapter } from "@/adapters/purchases/__tests__/mock.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import { StubHealthAdapter } from "@/adapters/health";
import { StubNotificationsAdapter } from "@/adapters/notifications";
import { InMemoryNetInfoAdapter } from "@/adapters/netInfo/__tests__/InMemoryNetInfoAdapter";
import type {
  MySubscription,
  SubscriptionTier,
} from "@/domain/models/subscription";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import {
  APP_STORE_SUBSCRIPTIONS_URL,
  IOSPurchaseFlowContainer,
} from "@/ui/containers/IOSPurchaseFlowContainer";

const mockPush = jest.fn();
const mockBack = jest.fn();
let mockParams: Record<string, string> = {};

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush, back: mockBack, replace: jest.fn() }),
  useLocalSearchParams: () => mockParams,
}));

const openURLSpy = jest
  .spyOn(Linking, "openURL")
  .mockResolvedValue(true as never);

const PREMIUM: SubscriptionTier = {
  tierName: "premium",
  displayName: "Premium",
  description: null,
  priceMonthly: 16.99,
  priceYearly: 139.99,
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
  stripePriceIdMonthly: null,
  stripePriceIdYearly: null,
};

function subscription(overrides: Partial<MySubscription> = {}): MySubscription {
  return {
    subscriptionId: null,
    tierName: "free",
    paymentStatus: "active",
    billingCycle: null,
    startsAt: "2026-08-05T00:00:00.000Z",
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
    ...overrides,
  };
}

function makeAdapters(current = subscription()): {
  adapters: Adapters;
  purchases: MockPurchasesAdapter;
} {
  const api = new InMemoryApiAdapter();
  const auth = new InMemoryAuthAdapter();
  const purchases = new MockPurchasesAdapter();
  api.subscriptionTiers = [PREMIUM];
  api.mySubscription = current;
  purchases.packages = [
    {
      packageId: "$rc_monthly",
      productId: "app.persistence.premium.monthly",
      tier: "premium",
      billingCycle: "monthly",
      priceString: "£16.99",
      introTrialDays: null,
    },
  ];
  auth.currentSession = {
    accessToken: "tok",
    refreshToken: "rtok",
    userId: "u-1",
    email: "x@y.com",
    expiresAt: Date.now() + 3_600_000,
  };
  return {
    purchases,
    adapters: {
      api,
      auth,
      storage: new InMemoryStorageAdapter(),
      health: new StubHealthAdapter(),
      notifications: new StubNotificationsAdapter(),
      netInfo: new InMemoryNetInfoAdapter(),
      purchases,
    },
  };
}

function renderContainer(adapters: Adapters) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <AdapterProvider adapters={adapters}>
        <IOSPurchaseFlowContainer />
      </AdapterProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockParams = {};
  mockPush.mockReset();
  mockBack.mockReset();
  openURLSpy.mockClear();
});

afterAll(() => {
  openURLSpy.mockRestore();
});

describe("IOSPurchaseFlowContainer", () => {
  it("starts a free user at the persona chooser", async () => {
    const { adapters } = makeAdapters();
    renderContainer(adapters);
    await waitFor(() =>
      expect(screen.getByTestId("subscription-persona-chooser")).toBeTruthy(),
    );
  });

  it("routes a persona into the matching catalog and cadence", async () => {
    const { adapters } = makeAdapters();
    renderContainer(adapters);
    await waitFor(() =>
      expect(screen.getByTestId("persona-self")).toBeTruthy(),
    );
    fireEvent.press(screen.getByTestId("persona-self"));

    expect(screen.getByTestId("subscription-card-premium_plus")).toBeTruthy();
    expect(screen.getByText("£249.99")).toBeTruthy();
  });

  it("uses a deep link to bypass persona and open coach plans", async () => {
    mockParams = { tier: "coach", cycle: "monthly" };
    const { adapters } = makeAdapters();
    renderContainer(adapters);
    await waitFor(() =>
      expect(
        screen.getByTestId("trainer-subscription-card-coach"),
      ).toBeTruthy(),
    );
  });

  it("never dispatches a purchase while the App Store catalog switch is off", async () => {
    mockParams = { tier: "premium", cycle: "monthly" };
    const { adapters, purchases } = makeAdapters();
    renderContainer(adapters);
    await waitFor(() =>
      expect(
        screen.getByTestId("subscription-card-premium-coming-soon"),
      ).toBeTruthy(),
    );
    expect(screen.queryByText("Subscribe")).toBeNull();
    expect(purchases.purchaseCalls).toEqual([]);
  });

  it("continues on the free tier without making a purchase", async () => {
    mockParams = { tier: "premium" };
    const { adapters, purchases } = makeAdapters();
    renderContainer(adapters);
    await waitFor(() =>
      expect(
        screen.getByTestId("subscription-card-free-continue"),
      ).toBeTruthy(),
    );
    fireEvent.press(screen.getByTestId("subscription-card-free-continue"));
    expect(mockPush).toHaveBeenCalledWith("/(auth)/success?tier=free");
    expect(purchases.purchaseCalls).toEqual([]);
  });

  it("opens paid users on management and hands billing to the App Store", async () => {
    const paid = subscription({
      subscriptionId: "sub-1",
      tierName: "premium",
      tierDisplayName: "Premium",
      billingCycle: "yearly",
      expiresAt: "2027-03-14T00:00:00.000Z",
      externalSubscriptionId: "rc-1",
    });
    const { adapters } = makeAdapters(paid);
    renderContainer(adapters);
    await waitFor(() =>
      expect(screen.getByTestId("subscription-manage-screen")).toBeTruthy(),
    );
    fireEvent.press(screen.getByTestId("ios-purchase-manage"));
    expect(openURLSpy).toHaveBeenCalledWith(APP_STORE_SUBSCRIPTIONS_URL);
  });

  it("changes from management into the plan catalog", async () => {
    const paid = subscription({
      subscriptionId: "sub-1",
      tierName: "premium",
      tierDisplayName: "Premium",
      billingCycle: "monthly",
      externalSubscriptionId: "rc-1",
    });
    const { adapters } = makeAdapters(paid);
    renderContainer(adapters);
    await waitFor(() =>
      expect(screen.getByTestId("subscription-change-plan")).toBeTruthy(),
    );
    fireEvent.press(screen.getByTestId("subscription-change-plan"));
    expect(screen.getByTestId("subscription-card-premium_plus")).toBeTruthy();
  });
});
