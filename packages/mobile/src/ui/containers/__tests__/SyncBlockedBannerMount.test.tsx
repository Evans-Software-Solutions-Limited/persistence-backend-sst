import { render, screen, fireEvent } from "@testing-library/react-native";
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
import type { EntitlementVerdict } from "@/domain/ports/sync.types";
// eslint-disable-next-line import/first
import type { Adapters } from "@/shared/types";
// eslint-disable-next-line import/first
import { AdapterProvider } from "@/ui/hooks/useAdapters";
// eslint-disable-next-line import/first
import { SyncBlockedBannerMount } from "@/ui/containers/SyncBlockedBannerMount";

function makeAdapters() {
  const storage = new InMemoryStorageAdapter();
  const adapters: Adapters = {
    api: new InMemoryApiAdapter(),
    auth: new InMemoryAuthAdapter(),
    storage,
    health: new StubHealthAdapter(),
    notifications: new StubNotificationsAdapter(),
    payments: new MockPaymentsAdapter(),
    netInfo: new InMemoryNetInfoAdapter(),
  };
  return { adapters, storage };
}

function renderMount(adapters: Adapters) {
  function TestWrapper({ children }: { children: ReactNode }) {
    return <AdapterProvider adapters={adapters}>{children}</AdapterProvider>;
  }
  return render(
    <TestWrapper>
      <SyncBlockedBannerMount />
    </TestWrapper>,
  );
}

function enqueueAndBlock(
  storage: InMemoryStorageAdapter,
  verdict: EntitlementVerdict,
) {
  storage.enqueueMutation({
    entityType: "workout",
    operation: "create",
    payload: {},
    endpoint: "/workouts",
    method: "POST",
  });
  const id = storage.getPendingMutations().slice(-1)[0].id;
  storage.markMutationBlocked(id, verdict);
}

describe("SyncBlockedBannerMount", () => {
  beforeEach(() => mockPush.mockReset());

  it("renders nothing when no entries are blocked", () => {
    const { adapters } = makeAdapters();
    renderMount(adapters);
    expect(screen.queryByTestId("sync-blocked-banner")).toBeNull();
  });

  it("renders the banner + most-common upgrade target when entries are blocked", () => {
    const { adapters, storage } = makeAdapters();
    enqueueAndBlock(storage, {
      feature: "create_workout",
      currentTier: "premium",
      upgradeTo: "premium",
      upgradePriceMonthly: 12.99,
      blockedAt: "2026-05-24T10:00:00.000Z",
    });
    enqueueAndBlock(storage, {
      feature: "create_workout",
      currentTier: "premium",
      upgradeTo: "premium",
      upgradePriceMonthly: 12.99,
      blockedAt: "2026-05-24T10:00:00.000Z",
    });
    renderMount(adapters);
    expect(screen.getByTestId("sync-blocked-banner")).toBeTruthy();
    expect(screen.getByText(/Upgrade to Premium/)).toBeTruthy();
  });

  it("falls back to null upgradeTargetLabel when no entry has an upgrade target", () => {
    const { adapters, storage } = makeAdapters();
    enqueueAndBlock(storage, {
      feature: "trainer_clients",
      currentTier: "individual_trainer",
      upgradeTo: null,
      upgradePriceMonthly: null,
      blockedAt: "2026-05-24T10:00:00.000Z",
    });
    renderMount(adapters);
    // No target → banner shows generic CTA wording.
    expect(screen.getByText(/Upgrade your plan/)).toBeTruthy();
  });

  it("routes Review tap to /(app)/sync-blocked", () => {
    const { adapters, storage } = makeAdapters();
    enqueueAndBlock(storage, {
      feature: "create_workout",
      currentTier: "premium",
      upgradeTo: "premium",
      upgradePriceMonthly: 12.99,
      blockedAt: "2026-05-24T10:00:00.000Z",
    });
    renderMount(adapters);
    fireEvent.press(screen.getByTestId("sync-blocked-banner-review"));
    expect(mockPush).toHaveBeenCalledWith("/(app)/sync-blocked");
  });
});
