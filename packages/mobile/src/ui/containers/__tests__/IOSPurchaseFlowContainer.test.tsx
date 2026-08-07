import React from "react";
import { Alert, Linking, Platform } from "react-native";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
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
  PLAY_STORE_SUBSCRIPTIONS_URL,
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
const alertSpy = jest.spyOn(Alert, "alert");

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

function pricedTier(
  tierName: SubscriptionTier["tierName"],
  displayName: string,
  priceMonthly: number,
  priceYearly: number,
  trainerClientLimit: number | null = null,
): SubscriptionTier {
  return {
    ...PREMIUM,
    tierName,
    displayName,
    priceMonthly,
    priceYearly,
    trainerClientLimit,
    isTrainerTier: trainerClientLimit !== null,
  };
}

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
  api: InMemoryApiAdapter;
  purchases: MockPurchasesAdapter;
} {
  const api = new InMemoryApiAdapter();
  const auth = new InMemoryAuthAdapter();
  const purchases = new MockPurchasesAdapter();
  api.subscriptionTiers = [
    PREMIUM,
    pricedTier("premium_plus", "Premium+", 29.99, 249.99),
    pricedTier("individual_trainer", "Start Up Coach", 18.99, 159.99, 5),
    pricedTier("start_up_coach_plus", "Start Up Coach +", 34.99, 289.99, 5),
    pricedTier("coach", "Coach", 59.99, 499.99, 15),
    pricedTier("coach_pro", "Coach Pro", 99.99, 839.99, 30),
  ];
  api.mySubscription = current;
  purchases.packages = [
    {
      packageId: "$rc_monthly",
      productId: "app.persistence.premium.monthly",
      tier: "premium",
      billingCycle: "monthly",
      price: 16.99,
      priceString: "£16.99",
      pricePerMonthString: "£16.99",
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
    api,
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
  alertSpy.mockReset();
});

afterAll(() => {
  openURLSpy.mockRestore();
  alertSpy.mockRestore();
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

  it("routes the coach persona into coach plans", async () => {
    const { adapters } = makeAdapters();
    renderContainer(adapters);
    fireEvent.press(await screen.findByTestId("persona-coach"));
    expect(
      screen.getByTestId("trainer-subscription-card-individual_trainer"),
    ).toBeTruthy();
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

  it("honours an explicit coach role and cadence-specific availability", async () => {
    mockParams = { role: "personal_trainer", cycle: "yearly" };
    const { adapters } = makeAdapters();
    renderContainer(adapters);

    await screen.findByTestId("trainer-subscription-card-coach");
    expect(screen.getByText("Annual")).toBeTruthy();
    expect(
      screen.getByTestId("trainer-subscription-card-individual_trainer"),
    ).toBeTruthy();
  });

  it("does not enable a yearly CTA from a monthly-only offering", async () => {
    mockParams = { tier: "premium", cycle: "yearly" };
    const { adapters } = makeAdapters();
    renderContainer(adapters);

    expect(
      await screen.findByTestId("subscription-card-premium-coming-soon"),
    ).toBeTruthy();
    expect(
      screen.queryByTestId("subscription-card-premium-subscribe"),
    ).toBeNull();
  });

  it("keeps a tier non-interactive when RevenueCat has no matching package", async () => {
    mockParams = { tier: "premium", cycle: "monthly" };
    const { adapters, purchases } = makeAdapters();
    purchases.packages = [];
    renderContainer(adapters);
    await waitFor(() =>
      expect(
        screen.getByTestId("subscription-card-premium-coming-soon"),
      ).toBeTruthy(),
    );
    expect(
      screen.queryByTestId("subscription-card-premium-subscribe"),
    ).toBeNull();
    expect(purchases.purchaseCalls).toEqual([]);
  });

  it("prints StoreKit's localised price over the API fallback", async () => {
    mockParams = { tier: "premium", cycle: "monthly" };
    const { adapters, purchases } = makeAdapters();
    purchases.packages[0] = {
      ...purchases.packages[0]!,
      price: 17.49,
      priceString: "US$17.49",
      pricePerMonthString: "US$17.49",
    };

    renderContainer(adapters);

    expect(await screen.findByText("US$17.49")).toBeTruthy();
    expect(screen.queryByText("£16.99")).toBeNull();
  });

  it("does not derive savings across partial StoreKit and API pricing", async () => {
    mockParams = { tier: "premium", cycle: "yearly" };
    const { adapters, purchases } = makeAdapters();
    purchases.packages[0] = {
      ...purchases.packages[0]!,
      price: 17.49,
      priceString: "US$17.49",
      pricePerMonthString: "US$17.49",
    };

    renderContainer(adapters);

    const card = await screen.findByTestId("subscription-card-premium");
    expect(within(card).getByText("£139.99")).toBeTruthy();
    expect(within(card).queryByText(/save \d+%/i)).toBeNull();
  });

  it("purchases and synchronises an available tier when the App Store rail is enabled", async () => {
    mockParams = { tier: "premium", cycle: "monthly" };
    const { adapters, api, purchases } = makeAdapters();
    purchases.nextPurchaseResponse = {
      ok: true,
      entitlements: [
        {
          entitlementId: "premium",
          productId: "app.persistence.premium.monthly",
          tier: "premium",
          expiresAt: "2026-09-05T00:00:00.000Z",
        },
      ],
    };

    renderContainer(adapters);
    fireEvent.press(
      await screen.findByTestId("subscription-card-premium-subscribe"),
    );

    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith("/(auth)/success?tier=premium"),
    );
    expect(purchases.purchaseCalls).toEqual(["$rc_monthly"]);
    expect(api.syncSubscriptionCalls).toBe(1);
  });

  it("shows only a real, eligible introductory trial", async () => {
    mockParams = { tier: "premium", cycle: "monthly" };
    const { adapters, purchases } = makeAdapters();
    purchases.packages[0] = {
      ...purchases.packages[0]!,
      introTrialDays: 7,
    };
    purchases.introEligibility = {
      "app.persistence.premium.monthly": true,
    };

    renderContainer(adapters);
    expect(await screen.findByText("7-day free trial")).toBeTruthy();
  });

  it.each([
    ["cancelled", "Purchase cancelled", null],
    ["pending", "Awaiting approval", "Purchase Pending"],
    ["network", "Store unavailable", "Purchase Error"],
    ["unknown", undefined, "Purchase Error"],
  ] as const)(
    "handles a %s purchase result without navigating",
    async (kind, message, expectedAlert) => {
      mockParams = { tier: "premium", cycle: "monthly" };
      const { adapters, purchases } = makeAdapters();
      purchases.nextPurchaseResponse = {
        ok: false,
        error: { kind, code: null, message: message as string },
      };

      renderContainer(adapters);
      await act(async () => {
        fireEvent.press(
          await screen.findByTestId("subscription-card-premium-subscribe"),
        );
      });

      await waitFor(() => expect(purchases.purchaseCalls).toHaveLength(1));
      expect(mockPush).not.toHaveBeenCalled();
      if (expectedAlert === null) {
        expect(alertSpy).not.toHaveBeenCalled();
      } else {
        expect(alertSpy).toHaveBeenCalledWith(
          expectedAlert,
          expect.any(String),
        );
      }
    },
  );

  it("does not block a successful Apple purchase when server sync is temporarily unavailable", async () => {
    mockParams = { tier: "premium", cycle: "monthly" };
    const { adapters, api } = makeAdapters();
    api.nextSyncSubscriptionError = {
      kind: "api",
      code: "server",
      message: "subscription_sync_failed",
      status: 502,
    };

    renderContainer(adapters);
    fireEvent.press(
      await screen.findByTestId("subscription-card-premium-subscribe"),
    );
    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith("/(auth)/success?tier=premium"),
    );
  });

  it("handles an offering disappearing between render and selection", async () => {
    mockParams = { tier: "premium", cycle: "monthly" };
    const { adapters, purchases } = makeAdapters();
    renderContainer(adapters);
    await screen.findByTestId("subscription-card-premium-subscribe");

    purchases.packages.splice(0);
    fireEvent.press(screen.getByTestId("subscription-card-premium-subscribe"));

    expect(alertSpy).toHaveBeenCalledWith(
      "Not available",
      expect.stringContaining("monthly basis"),
    );
    expect(purchases.purchaseCalls).toEqual([]);
  });

  it.each([
    ["paid", "premium", "/(auth)/success?tier=premium"],
    ["free", "free", null],
    ["sync-error", "premium", null],
  ] as const)(
    "restores purchases when the server result is %s",
    async (scenario, tierName, expectedRoute) => {
      const { adapters, api, purchases } = makeAdapters();
      purchases.nextRestoreResponse = {
        ok: true,
        entitlements: [
          {
            entitlementId: "premium",
            tier: "premium",
            productId: "app.persistence.premium.monthly",
            expiresAt: null,
          },
        ],
      };
      api.nextSyncSubscriptionResult = subscription({ tierName });
      if (scenario === "sync-error") {
        api.nextSyncSubscriptionError = {
          kind: "api",
          code: "server",
          message: "subscription_sync_failed",
          status: 502,
        };
      }

      renderContainer(adapters);
      fireEvent.press(await screen.findByTestId("ios-purchase-restore"));
      await waitFor(() => expect(purchases.restoreCalls).toBe(1));

      if (expectedRoute === null) {
        expect(mockPush).not.toHaveBeenCalled();
        expect(alertSpy).toHaveBeenCalled();
      } else {
        await waitFor(() =>
          expect(mockPush).toHaveBeenCalledWith(expectedRoute),
        );
      }
    },
  );

  it("reports empty and failed restores", async () => {
    const { adapters, purchases } = makeAdapters();
    renderContainer(adapters);
    fireEvent.press(await screen.findByTestId("ios-purchase-restore"));
    await waitFor(() =>
      expect(alertSpy).toHaveBeenCalledWith(
        "Nothing to Restore",
        expect.any(String),
      ),
    );

    purchases.nextRestoreResponse = {
      ok: false,
      error: { kind: "network", code: null, message: "Offline" },
    };
    fireEvent.press(screen.getByTestId("ios-purchase-restore"));
    await waitFor(() =>
      expect(alertSpy).toHaveBeenCalledWith("Restore Failed", "Offline"),
    );

    purchases.nextRestoreResponse = {
      ok: false,
      error: { kind: "unknown", code: null, message: undefined as never },
    };
    fireEvent.press(screen.getByTestId("ios-purchase-restore"));
    await waitFor(() =>
      expect(alertSpy).toHaveBeenCalledWith(
        "Restore Failed",
        "Couldn't restore purchases. Please try again.",
      ),
    );
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
    await waitFor(() =>
      expect(openURLSpy).toHaveBeenCalledWith(APP_STORE_SUBSCRIPTIONS_URL),
    );
  });

  it("hands Android subscription management to Google Play", async () => {
    const originalOS = Platform.OS;
    Platform.OS = "android";
    try {
      const paid = subscription({
        subscriptionId: "sub-1",
        tierName: "premium",
        tierDisplayName: "Premium",
        billingCycle: "monthly",
        expiresAt: "2027-03-14T00:00:00.000Z",
        externalSubscriptionId: "rc-1",
      });
      const { adapters } = makeAdapters(paid);
      renderContainer(adapters);
      await waitFor(() =>
        expect(screen.getByTestId("subscription-manage-screen")).toBeTruthy(),
      );
      fireEvent.press(screen.getByTestId("ios-purchase-manage"));
      await waitFor(() =>
        expect(openURLSpy).toHaveBeenCalledWith(PLAY_STORE_SUBSCRIPTIONS_URL),
      );
      expect(screen.getByText("Google Play")).toBeTruthy();
    } finally {
      Platform.OS = originalOS;
    }
  });

  it("uses RevenueCat's originating-store management URL across platforms", async () => {
    const originalOS = Platform.OS;
    Platform.OS = "android";
    try {
      const paid = subscription({
        subscriptionId: "sub-1",
        tierName: "premium",
        tierDisplayName: "Premium",
        billingCycle: "monthly",
        externalSubscriptionId: "rc-1",
      });
      const { adapters, purchases } = makeAdapters(paid);
      purchases.managementUrl = APP_STORE_SUBSCRIPTIONS_URL;
      renderContainer(adapters);
      fireEvent.press(await screen.findByTestId("ios-purchase-manage"));
      await waitFor(() =>
        expect(openURLSpy).toHaveBeenCalledWith(APP_STORE_SUBSCRIPTIONS_URL),
      );
      expect(purchases.managementUrlCalls).toBe(1);
    } finally {
      Platform.OS = originalOS;
    }
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

  it("returns a subscriber from the plan catalog back to Manage, not the persona chooser", async () => {
    const paid = subscription({
      subscriptionId: "sub-1",
      tierName: "premium",
      tierDisplayName: "Premium",
      billingCycle: "monthly",
      externalSubscriptionId: "rc-1",
    });
    const { adapters } = makeAdapters(paid);
    renderContainer(adapters);
    // Manage → Change plan → plan catalog.
    fireEvent.press(await screen.findByTestId("subscription-change-plan"));
    expect(screen.getByTestId("subscription-card-premium_plus")).toBeTruthy();
    // Back must return to Manage (where plans was opened from), NOT the
    // "How will you use Persistence?" persona chooser.
    fireEvent.press(screen.getByTestId("ios-purchase-back"));
    expect(screen.getByTestId("subscription-manage-screen")).toBeTruthy();
    expect(screen.queryByTestId("subscription-persona-chooser")).toBeNull();
  });

  it("returns a new user from the plan catalog back to the persona chooser", async () => {
    const { adapters } = makeAdapters();
    renderContainer(adapters);
    fireEvent.press(await screen.findByTestId("persona-self"));
    expect(screen.getByTestId("subscription-card-premium_plus")).toBeTruthy();
    // A free user reached plans via the persona chooser, so Back returns there.
    fireEvent.press(screen.getByTestId("ios-purchase-back"));
    expect(screen.getByTestId("subscription-persona-chooser")).toBeTruthy();
  });

  it("derives coach plans from an existing physiotherapist subscription", async () => {
    const paid = subscription({
      subscriptionId: "sub-physio",
      tierName: "premium",
      role: "physiotherapist",
      billingCycle: "monthly",
      externalSubscriptionId: "rc-physio",
    });
    const { adapters } = makeAdapters(paid);
    renderContainer(adapters);
    fireEvent.press(await screen.findByTestId("subscription-change-plan"));
    expect(
      screen.getByTestId("trainer-subscription-card-individual_trainer"),
    ).toBeTruthy();
  });

  it("moves back through the plan chooser before leaving the rail", async () => {
    mockParams = { tier: "premium", cycle: "monthly" };
    const { adapters } = makeAdapters();
    renderContainer(adapters);
    fireEvent.press(await screen.findByTestId("ios-purchase-back"));
    expect(screen.getByTestId("subscription-persona-chooser")).toBeTruthy();

    fireEvent.press(screen.getByTestId("ios-purchase-back"));
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it("retries failed catalog queries", async () => {
    const { adapters, api } = makeAdapters();
    api.shouldFail = true;
    renderContainer(adapters);
    await screen.findByTestId("ios-purchase-retry");
    api.shouldFail = false;
    fireEvent.press(screen.getByTestId("ios-purchase-retry"));
    await waitFor(() =>
      expect(screen.getByTestId("subscription-persona-chooser")).toBeTruthy(),
    );
  });
});
