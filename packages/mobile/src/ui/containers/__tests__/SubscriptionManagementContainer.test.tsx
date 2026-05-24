import { Alert } from "react-native";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TamaguiProvider } from "@tamagui/core";
import type { ReactNode } from "react";
import config from "../../../../tamagui.config";
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
import { SubscriptionManagementContainer } from "@/ui/containers/SubscriptionManagementContainer";

const mockBack = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ back: mockBack, push: jest.fn(), replace: jest.fn() }),
}));

const alertSpy = jest.spyOn(Alert, "alert");

function makeAdapters(sub: MySubscription | null): {
  adapters: Adapters;
  api: InMemoryApiAdapter;
  netInfo: InMemoryNetInfoAdapter;
} {
  const api = new InMemoryApiAdapter();
  const auth = new InMemoryAuthAdapter();
  const netInfo = new InMemoryNetInfoAdapter();
  api.mySubscription = sub;
  auth.currentSession = {
    accessToken: "tok",
    refreshToken: "rtok",
    userId: "u-1",
    email: "x@y.com",
    expiresAt: Date.now() + 3600_000,
  };
  const adapters: Adapters = {
    api,
    auth,
    storage: new InMemoryStorageAdapter(),
    health: new StubHealthAdapter(),
    notifications: new StubNotificationsAdapter(),
    payments: new MockPaymentsAdapter(),
    netInfo,
  };
  return { adapters, api, netInfo };
}

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function Wrapper({
  adapters,
  queryClient,
  children,
}: {
  adapters: Adapters;
  queryClient: QueryClient;
  children: ReactNode;
}) {
  return (
    <TamaguiProvider config={config} defaultTheme="dark">
      <QueryClientProvider client={queryClient}>
        <AdapterProvider adapters={adapters}>{children}</AdapterProvider>
      </QueryClientProvider>
    </TamaguiProvider>
  );
}

const PREMIUM_SUB: MySubscription = {
  subscriptionId: "us_1",
  tierName: "premium",
  paymentStatus: "active",
  billingCycle: "monthly",
  startsAt: "2026-01-01T00:00:00.000Z",
  expiresAt: "2026-07-01T00:00:00.000Z",
  cancelledAt: null,
  trialEndsAt: null,
  externalSubscriptionId: "sub_1",
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
  isEligibleForUserTrial: false,
  isEligibleForTrainerTrial: false,
  scheduledChange: null,
};

const BASIC_SUB: MySubscription = {
  ...PREMIUM_SUB,
  tierName: "basic",
  tierDisplayName: "Basic",
};

beforeEach(() => {
  mockBack.mockReset();
  alertSpy.mockReset();
});

afterAll(() => {
  alertSpy.mockRestore();
});

describe("SubscriptionManagementContainer", () => {
  it("renders the management screen once data loads", async () => {
    const { adapters } = makeAdapters(BASIC_SUB);
    render(
      <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
        <SubscriptionManagementContainer />
      </Wrapper>,
    );
    // Wait for both the title and the tier name. The query enables
    // only after the auth context surfaces the userId, which races
    // the initial render — so both assertions need waitFor.
    await waitFor(() => expect(screen.getByText("Basic")).toBeTruthy());
    expect(screen.getByText("Current Plan")).toBeTruthy();
  });

  it("upgrade: shows confirmation alert; on confirm calls createSubscription WITHOUT paymentMethodId", async () => {
    const { adapters, api } = makeAdapters(BASIC_SUB);
    render(
      <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
        <SubscriptionManagementContainer />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("management-upgrade-button")).toBeTruthy(),
    );

    await act(async () => {
      fireEvent.press(screen.getByTestId("management-upgrade-button"));
    });

    // Confirm alert was shown
    expect(alertSpy).toHaveBeenCalledWith(
      "Upgrade Subscription",
      expect.stringContaining("prorated"),
      expect.any(Array),
    );

    // Simulate user tapping "Upgrade"
    const upgradeAlert = alertSpy.mock.calls.find(
      ([title]) => title === "Upgrade Subscription",
    );
    const upgradeButton = upgradeAlert?.[2]?.find((b) => b.text === "Upgrade");
    await act(async () => {
      await upgradeButton?.onPress?.();
    });

    expect(api.createSubscriptionCalls).toBe(1);
    expect(api.lastCreateSubscriptionInput).toEqual({
      tierName: "premium",
      billingCycle: "monthly",
      useTrial: false,
    });
    expect(api.lastCreateSubscriptionInput?.paymentMethodId).toBeUndefined();
  });

  it("downgrade: shows confirmation alert; on confirm uses tier_name='basic' + effectiveAt success alert", async () => {
    const { adapters, api } = makeAdapters(PREMIUM_SUB);
    api.setNextCreateSubscriptionResponse({
      changeType: "downgrade",
      scheduled: true,
      effectiveAt: "2026-07-01T00:00:00.000Z",
    });
    render(
      <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
        <SubscriptionManagementContainer />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("management-downgrade-button")).toBeTruthy(),
    );
    await act(async () => {
      fireEvent.press(screen.getByTestId("management-downgrade-button"));
    });
    const downgradeAlert = alertSpy.mock.calls.find(
      ([title]) => title === "Downgrade Subscription",
    );
    const downgradeButton = downgradeAlert?.[2]?.find(
      (b) => b.text === "Downgrade",
    );
    await act(async () => {
      await downgradeButton?.onPress?.();
    });
    expect(api.lastCreateSubscriptionInput).toEqual({
      tierName: "basic",
      billingCycle: "monthly",
      useTrial: false,
    });
    // Success alert shows effective date
    await waitFor(() => {
      const successCall = alertSpy.mock.calls.find(
        ([title]) => title === "Success",
      );
      expect(successCall).toBeTruthy();
    });
  });

  it("cancel: shows trial-aware confirmation; on confirm calls cancelSubscription", async () => {
    const trialingSub = {
      ...PREMIUM_SUB,
      paymentStatus: "trialing" as const,
      trialEndsAt: "2026-06-01T00:00:00.000Z",
    };
    const { adapters, api } = makeAdapters(trialingSub);
    render(
      <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
        <SubscriptionManagementContainer />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("management-cancel-button")).toBeTruthy(),
    );
    await act(async () => {
      fireEvent.press(screen.getByTestId("management-cancel-button"));
    });
    const cancelAlert = alertSpy.mock.calls.find(
      ([title]) => title === "Cancel Subscription",
    );
    expect(cancelAlert?.[1]).toMatch(/trial/);
    const destructiveButton = cancelAlert?.[2]?.find(
      (b) => b.style === "destructive",
    );
    await act(async () => {
      await destructiveButton?.onPress?.();
    });
    expect(api.cancelSubscriptionCalls).toBe(1);
    expect(api.lastCancelSubscription?.subscriptionId).toBe("us_1");
  });

  it("cancel from active (non-trialing) sub: success alert uses 'subscription' wording", async () => {
    const { adapters, api } = makeAdapters(PREMIUM_SUB);
    render(
      <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
        <SubscriptionManagementContainer />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("management-cancel-button")).toBeTruthy(),
    );
    await act(async () => {
      fireEvent.press(screen.getByTestId("management-cancel-button"));
    });
    const cancelAlert = alertSpy.mock.calls.find(
      ([title]) => title === "Cancel Subscription",
    );
    expect(cancelAlert?.[1]).not.toMatch(/trial/);
    const destructive = cancelAlert?.[2]?.find(
      (b) => b.style === "destructive",
    );
    await act(async () => {
      await destructive?.onPress?.();
    });
    expect(api.cancelSubscriptionCalls).toBe(1);
    const successAlert = alertSpy.mock.calls.find(
      ([title]) => title === "Subscription Cancelled",
    );
    expect(successAlert?.[1]).toMatch(/Your subscription will end/);
  });

  it("does not show upgrade for premium tier (only basic can upgrade)", async () => {
    const { adapters } = makeAdapters(PREMIUM_SUB);
    render(
      <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
        <SubscriptionManagementContainer />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("management-downgrade-button")).toBeTruthy(),
    );
    expect(screen.queryByTestId("management-upgrade-button")).toBeNull();
  });

  it("alerts the user when upgrade fails", async () => {
    const { adapters, api } = makeAdapters(BASIC_SUB);
    render(
      <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
        <SubscriptionManagementContainer />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("management-upgrade-button")).toBeTruthy(),
    );
    api.shouldFail = true;
    await act(async () => {
      fireEvent.press(screen.getByTestId("management-upgrade-button"));
    });
    const upgradeAlert = alertSpy.mock.calls.find(
      ([title]) => title === "Upgrade Subscription",
    );
    const upgradeButton = upgradeAlert?.[2]?.find((b) => b.text === "Upgrade");
    await act(async () => {
      await upgradeButton?.onPress?.();
    });
    await waitFor(() =>
      expect(alertSpy.mock.calls.some(([title]) => title === "Error")).toBe(
        true,
      ),
    );
  });

  it("alerts the user when downgrade fails", async () => {
    const { adapters, api } = makeAdapters(PREMIUM_SUB);
    render(
      <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
        <SubscriptionManagementContainer />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("management-downgrade-button")).toBeTruthy(),
    );
    api.shouldFail = true;
    await act(async () => {
      fireEvent.press(screen.getByTestId("management-downgrade-button"));
    });
    const downgradeAlert = alertSpy.mock.calls.find(
      ([title]) => title === "Downgrade Subscription",
    );
    const downgradeButton = downgradeAlert?.[2]?.find(
      (b) => b.text === "Downgrade",
    );
    await act(async () => {
      await downgradeButton?.onPress?.();
    });
    await waitFor(() =>
      expect(alertSpy.mock.calls.some(([title]) => title === "Error")).toBe(
        true,
      ),
    );
  });

  it("alerts the user when cancel fails", async () => {
    const { adapters, api } = makeAdapters(PREMIUM_SUB);
    render(
      <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
        <SubscriptionManagementContainer />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("management-cancel-button")).toBeTruthy(),
    );
    api.shouldFail = true;
    await act(async () => {
      fireEvent.press(screen.getByTestId("management-cancel-button"));
    });
    const cancelAlert = alertSpy.mock.calls.find(
      ([title]) => title === "Cancel Subscription",
    );
    const destructive = cancelAlert?.[2]?.find(
      (b) => b.style === "destructive",
    );
    await act(async () => {
      await destructive?.onPress?.();
    });
    await waitFor(() =>
      expect(alertSpy.mock.calls.some(([title]) => title === "Error")).toBe(
        true,
      ),
    );
  });

  it("defaults billingCycle to monthly when sub has null billingCycle", async () => {
    const subNoBilling = { ...BASIC_SUB, billingCycle: null };
    const { adapters, api } = makeAdapters(subNoBilling);
    render(
      <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
        <SubscriptionManagementContainer />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("management-upgrade-button")).toBeTruthy(),
    );
    await act(async () => {
      fireEvent.press(screen.getByTestId("management-upgrade-button"));
    });
    const upgradeAlert = alertSpy.mock.calls.find(
      ([title]) => title === "Upgrade Subscription",
    );
    const upgradeButton = upgradeAlert?.[2]?.find((b) => b.text === "Upgrade");
    await act(async () => {
      await upgradeButton?.onPress?.();
    });
    expect(api.lastCreateSubscriptionInput?.billingCycle).toBe("monthly");
  });

  it("downgrade without effectiveAt uses fallback wording", async () => {
    const { adapters, api } = makeAdapters(PREMIUM_SUB);
    api.setNextCreateSubscriptionResponse({
      changeType: "downgrade",
      scheduled: false,
      effectiveAt: null,
    });
    render(
      <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
        <SubscriptionManagementContainer />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("management-downgrade-button")).toBeTruthy(),
    );
    await act(async () => {
      fireEvent.press(screen.getByTestId("management-downgrade-button"));
    });
    const downgradeAlert = alertSpy.mock.calls.find(
      ([title]) => title === "Downgrade Subscription",
    );
    const downgradeButton = downgradeAlert?.[2]?.find(
      (b) => b.text === "Downgrade",
    );
    await act(async () => {
      await downgradeButton?.onPress?.();
    });
    const successAlert = alertSpy.mock.calls.find(
      ([title]) => title === "Success",
    );
    expect(successAlert?.[1]).toMatch(/end of your current billing period/);
  });

  it("does nothing when cancel pressed but subscriptionId is null (free shape)", async () => {
    const freeSub = {
      ...BASIC_SUB,
      tierName: "free" as const,
      subscriptionId: null,
    };
    const { adapters, api } = makeAdapters(freeSub);
    render(
      <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
        <SubscriptionManagementContainer />
      </Wrapper>,
    );
    // No cancel button on free tier.
    await waitFor(() => expect(screen.getByText("Free")).toBeTruthy());
    expect(screen.queryByTestId("management-cancel-button")).toBeNull();
    // Even if we somehow called cancel, no mutation should fire.
    expect(api.cancelSubscriptionCalls).toBe(0);
  });

  it("calls router.back when back is pressed", async () => {
    const { adapters } = makeAdapters(BASIC_SUB);
    render(
      <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
        <SubscriptionManagementContainer />
      </Wrapper>,
    );
    // Wait for data load so the post-loading view renders the back button.
    await waitFor(() => expect(screen.getByText("Current Plan")).toBeTruthy());
    await waitFor(() =>
      expect(screen.getByTestId("subscription-management-back")).toBeTruthy(),
    );
    fireEvent.press(screen.getByTestId("subscription-management-back"));
    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});
