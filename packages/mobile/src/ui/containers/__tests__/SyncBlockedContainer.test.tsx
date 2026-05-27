import {
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Alert } from "react-native";

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
import type { MySubscription } from "@/domain/models/subscription";
// eslint-disable-next-line import/first
import type { Adapters } from "@/shared/types";
// eslint-disable-next-line import/first
import { AdapterProvider } from "@/ui/hooks/useAdapters";
// eslint-disable-next-line import/first
import { SyncBlockedContainer } from "@/ui/containers/SyncBlockedContainer";

function makeAdapters(): {
  adapters: Adapters;
  storage: InMemoryStorageAdapter;
  auth: InMemoryAuthAdapter;
  api: InMemoryApiAdapter;
} {
  const storage = new InMemoryStorageAdapter();
  const auth = new InMemoryAuthAdapter();
  const api = new InMemoryApiAdapter();
  const adapters: Adapters = {
    api,
    auth,
    storage,
    health: new StubHealthAdapter(),
    notifications: new StubNotificationsAdapter(),
    payments: new MockPaymentsAdapter(),
    netInfo: new InMemoryNetInfoAdapter(),
  };
  return { adapters, storage, auth, api };
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

function makeSub(overrides: Partial<MySubscription> = {}): MySubscription {
  return {
    subscriptionId: "us_1",
    tierName: "premium",
    paymentStatus: "active",
    billingCycle: "monthly",
    startsAt: "2026-01-01T00:00:00.000Z",
    expiresAt: "2030-01-01T00:00:00.000Z",
    cancelledAt: null,
    trialEndsAt: null,
    externalSubscriptionId: "sub_1",
    tierDisplayName: "Basic",
    tierDescription: null,
    workoutLimit: 10,
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

function renderContainer(adapters: Adapters, queryClient: QueryClient) {
  function TestWrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <AdapterProvider adapters={adapters}>{children}</AdapterProvider>
      </QueryClientProvider>
    );
  }
  return render(
    <TestWrapper>
      <SyncBlockedContainer />
    </TestWrapper>,
  );
}

function enqueueAndBlock(
  storage: InMemoryStorageAdapter,
  verdict: { upgradeTo: MySubscription["tierName"] | null; feature?: string },
): number {
  storage.enqueueMutation({
    entityType: "workout",
    operation: "create",
    payload: {},
    endpoint: "/workouts",
    method: "POST",
  });
  const id = storage.getPendingMutations().slice(-1)[0].id;
  storage.markMutationBlocked(id, {
    feature: (verdict.feature as "create_workout") ?? "create_workout",
    currentTier: "premium",
    upgradeTo: verdict.upgradeTo,
    upgradePriceMonthly: verdict.upgradeTo ? 12.99 : null,
    blockedAt: "2026-05-24T10:00:00.000Z",
  });
  return id;
}

describe("SyncBlockedContainer", () => {
  beforeEach(() => {
    mockPush.mockReset();
  });

  it("renders the empty state when no entries are blocked", async () => {
    const { adapters, auth, api } = makeAdapters();
    signIn(auth);
    api.mySubscription = makeSub();

    renderContainer(adapters, makeQueryClient());
    await waitFor(() =>
      expect(screen.getByTestId("sync-blocked-empty")).toBeTruthy(),
    );
  });

  it("groups entries by upgrade target and renders one card per group", async () => {
    const { adapters, storage, auth, api } = makeAdapters();
    signIn(auth);
    api.mySubscription = makeSub();
    enqueueAndBlock(storage, { upgradeTo: "premium" });
    enqueueAndBlock(storage, { upgradeTo: "premium" });
    enqueueAndBlock(storage, { upgradeTo: "individual_trainer" });

    renderContainer(adapters, makeQueryClient());

    await waitFor(() => {
      expect(screen.getByTestId("sync-blocked-group-premium")).toBeTruthy();
    });
    expect(
      screen.getByTestId("sync-blocked-group-individual_trainer"),
    ).toBeTruthy();
  });

  it("Upgrade CTA pushes to /(auth)/subscription-selection with the right tier + cycle", async () => {
    const { adapters, storage, auth, api } = makeAdapters();
    signIn(auth);
    api.mySubscription = makeSub({ billingCycle: "yearly" });
    enqueueAndBlock(storage, { upgradeTo: "premium" });

    const queryClient = makeQueryClient();
    // Seed the subscription cache synchronously so the container's
    // first render already has billingCycle === "yearly" — without this
    // the `useMySubscription` query is still in-flight when the user
    // presses Upgrade and we'd fall back to the "monthly" default.
    queryClient.setQueryData(
      ["user-subscription", "u-1"],
      makeSub({ billingCycle: "yearly" }),
    );

    renderContainer(adapters, queryClient);
    await waitFor(() =>
      expect(screen.getByTestId("sync-blocked-upgrade-premium")).toBeTruthy(),
    );
    fireEvent.press(screen.getByTestId("sync-blocked-upgrade-premium"));
    expect(mockPush).toHaveBeenCalledWith(
      "/(auth)/subscription-selection?tier=premium&cycle=yearly",
    );
  });

  it("Upgrade CTA defaults to monthly cycle when subscription cycle is null", async () => {
    const { adapters, storage, auth, api } = makeAdapters();
    signIn(auth);
    api.mySubscription = makeSub({ billingCycle: null });
    enqueueAndBlock(storage, { upgradeTo: "premium" });

    renderContainer(adapters, makeQueryClient());
    await waitFor(() =>
      expect(screen.getByTestId("sync-blocked-upgrade-premium")).toBeTruthy(),
    );
    fireEvent.press(screen.getByTestId("sync-blocked-upgrade-premium"));
    expect(mockPush).toHaveBeenCalledWith(
      "/(auth)/subscription-selection?tier=premium&cycle=monthly",
    );
  });

  it("Discard CTA shows confirmation Alert and deletes on confirm", async () => {
    const alertSpy = jest
      .spyOn(Alert, "alert")
      .mockImplementation((_t, _m, buttons) => {
        const destructive = buttons?.find((b) => b.style === "destructive");
        destructive?.onPress?.();
      });

    const { adapters, storage, auth, api } = makeAdapters();
    signIn(auth);
    api.mySubscription = makeSub();
    enqueueAndBlock(storage, { upgradeTo: "premium" });

    renderContainer(adapters, makeQueryClient());
    await waitFor(() =>
      expect(screen.getByTestId("sync-blocked-discard-premium")).toBeTruthy(),
    );
    fireEvent.press(screen.getByTestId("sync-blocked-discard-premium"));

    expect(alertSpy).toHaveBeenCalledWith(
      "Discard blocked items?",
      expect.stringContaining("this 1 item"),
      expect.any(Array),
    );
    // After the destructive button fires, storage was cleared and the
    // hook refresh re-rendered the empty state.
    await waitFor(() => {
      expect(storage.getBlockedEntries()).toHaveLength(0);
    });
    alertSpy.mockRestore();
  });

  it("Discard CTA's Cancel button does NOT delete entries", async () => {
    const alertSpy = jest
      .spyOn(Alert, "alert")
      .mockImplementation((_t, _m, buttons) => {
        const cancel = buttons?.find((b) => b.style === "cancel");
        cancel?.onPress?.();
      });

    const { adapters, storage, auth, api } = makeAdapters();
    signIn(auth);
    api.mySubscription = makeSub();
    enqueueAndBlock(storage, { upgradeTo: "premium" });

    renderContainer(adapters, makeQueryClient());
    await waitFor(() =>
      expect(screen.getByTestId("sync-blocked-discard-premium")).toBeTruthy(),
    );
    fireEvent.press(screen.getByTestId("sync-blocked-discard-premium"));

    expect(storage.getBlockedEntries()).toHaveLength(1);
    alertSpy.mockRestore();
  });

  it("Contact support CTA fires Alert when upgradeTo is null", async () => {
    const alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    const { adapters, storage, auth, api } = makeAdapters();
    signIn(auth);
    api.mySubscription = makeSub();
    enqueueAndBlock(storage, { upgradeTo: null });

    renderContainer(adapters, makeQueryClient());
    await waitFor(() =>
      expect(
        screen.getByTestId("sync-blocked-contact-no-upgrade"),
      ).toBeTruthy(),
    );
    fireEvent.press(screen.getByTestId("sync-blocked-contact-no-upgrade"));
    expect(alertSpy).toHaveBeenCalledWith(
      "Contact support",
      expect.stringContaining("support@persistence.app"),
    );
    alertSpy.mockRestore();
  });
});
