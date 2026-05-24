import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
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
import type {
  MySubscription,
  SubscriptionTierName,
} from "@/domain/models/subscription";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import {
  SubscriptionSuccessContainer,
  getSubscriptionBenefits,
  getSuccessMessage,
} from "@/ui/containers/SubscriptionSuccessContainer";

const mockReplace = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ replace: mockReplace, push: jest.fn(), back: jest.fn() }),
}));

function makeAdapters(sub: MySubscription | null): {
  adapters: Adapters;
  api: InMemoryApiAdapter;
} {
  const api = new InMemoryApiAdapter();
  const auth = new InMemoryAuthAdapter();
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
  };
  return { adapters, api };
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

const SUB_PREMIUM: MySubscription = {
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

beforeEach(() => {
  mockReplace.mockReset();
});

describe("SubscriptionSuccessContainer", () => {
  it("renders premium-tier message + benefits and routes to home", async () => {
    const { adapters } = makeAdapters(SUB_PREMIUM);
    render(
      <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
        <SubscriptionSuccessContainer />
      </Wrapper>,
    );
    // Container defaults to "basic" until the useMySubscription query
    // resolves — wait for the premium copy to appear.
    await waitFor(() =>
      expect(
        screen.getByText(/premium subscription is now active/),
      ).toBeTruthy(),
    );
    expect(screen.getByText("Subscription Activated!")).toBeTruthy();
    expect(screen.getByText("Unlimited Workouts")).toBeTruthy();
    fireEvent.press(screen.getByTestId("success-go-home"));
    expect(mockReplace).toHaveBeenCalledWith("/(app)/(tabs)");
  });

  it("shows Manage Clients CTA on trainer tiers and routes appropriately", async () => {
    const trainerSub: MySubscription = {
      ...SUB_PREMIUM,
      tierName: "individual_trainer_pro",
      isTrainerTier: true,
    };
    const { adapters } = makeAdapters(trainerSub);
    render(
      <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
        <SubscriptionSuccessContainer />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("success-manage-clients")).toBeTruthy(),
    );
    fireEvent.press(screen.getByTestId("success-manage-clients"));
    expect(mockReplace).toHaveBeenCalledWith("/(app)/(tabs)/clients");
  });

  it("falls back to 'basic' messaging when no subscription is loaded yet", async () => {
    const { adapters } = makeAdapters(null);
    render(
      <Wrapper adapters={adapters} queryClient={makeQueryClient()}>
        <SubscriptionSuccessContainer />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(screen.getByText("Subscription Activated!")).toBeTruthy(),
    );
    // Default fallback is 'basic'
    expect(screen.getByText(/basic subscription is now active/)).toBeTruthy();
  });
});

describe("getSubscriptionBenefits", () => {
  it("returns base benefit for basic / premium", () => {
    expect(getSubscriptionBenefits("basic")).toHaveLength(1);
    expect(getSubscriptionBenefits("premium")).toHaveLength(1);
  });

  it("adds Client Management for any trainer / business / enterprise tier", () => {
    const tiers: SubscriptionTierName[] = [
      "individual_trainer_standard",
      "individual_trainer_pro",
      "small_business_standard",
      "small_business_pro",
      "medium_enterprise_standard",
      "medium_enterprise_pro",
    ];
    for (const tier of tiers) {
      const benefits = getSubscriptionBenefits(tier);
      expect(benefits.some((b) => b.title === "Client Management")).toBe(true);
    }
  });

  it("adds AI Analytics for any _pro trainer tier", () => {
    const benefits = getSubscriptionBenefits("individual_trainer_pro");
    expect(benefits.some((b) => b.title === "AI Analytics & Gym Buddy")).toBe(
      true,
    );
  });
});

describe("getSuccessMessage", () => {
  it("returns trainer-specific copy for trainer tiers", () => {
    expect(getSuccessMessage("individual_trainer_pro")).toMatch(
      /trainer subscription is now active/,
    );
    expect(getSuccessMessage("small_business_standard")).toMatch(
      /trainer subscription/,
    );
  });

  it("returns premium copy for premium", () => {
    expect(getSuccessMessage("premium")).toMatch(/premium subscription/);
  });

  it("returns basic copy for basic", () => {
    expect(getSuccessMessage("basic")).toMatch(/basic subscription/);
  });

  it("returns generic fallback for free", () => {
    expect(getSuccessMessage("free")).toMatch(/subscription is now active/);
  });
});
