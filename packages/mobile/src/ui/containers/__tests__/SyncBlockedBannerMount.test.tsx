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

  // Inspector Brad PR #73 sweep #4 low-severity find — the multi-track
  // branch was promised in the block comment but never implemented;
  // we picked the mode and advertised one track's tier even when the
  // other track's entries couldn't be satisfied by it. Now detected.
  it("falls back to generic copy when blocked entries span BOTH user and trainer tracks", () => {
    const { adapters, storage } = makeAdapters();
    // User-track entry: upgrade to premium.
    enqueueAndBlock(storage, {
      feature: "ai_workout",
      currentTier: "free",
      upgradeTo: "premium",
      upgradePriceMonthly: 12.99,
      blockedAt: "2026-05-24T10:00:00.000Z",
    });
    // Trainer-track entry: upgrade to individual_trainer.
    enqueueAndBlock(storage, {
      feature: "trainer_clients",
      currentTier: "free",
      upgradeTo: "individual_trainer",
      upgradePriceMonthly: 14.99,
      blockedAt: "2026-05-24T10:01:00.000Z",
    });
    renderMount(adapters);
    expect(screen.getByTestId("sync-blocked-banner")).toBeTruthy();
    // Generic copy — neither "Upgrade to Premium" nor "Upgrade to
    // Individual Trainer" is honest because each one fails to satisfy
    // the other track's entries.
    expect(screen.getByText(/Upgrade your plan/)).toBeTruthy();
    expect(screen.queryByText(/Upgrade to Premium/)).toBeNull();
    expect(screen.queryByText(/Upgrade to Individual Trainer/)).toBeNull();
  });

  it("single-track multi-tier (all trainer) still picks the mode trainer tier", () => {
    const { adapters, storage } = makeAdapters();
    // Two entries needing individual_trainer, one needing small_business.
    // All on the trainer track — should NOT trigger the multi-track guard.
    enqueueAndBlock(storage, {
      feature: "trainer_clients",
      currentTier: "free",
      upgradeTo: "individual_trainer",
      upgradePriceMonthly: 14.99,
      blockedAt: "2026-05-24T10:00:00.000Z",
    });
    enqueueAndBlock(storage, {
      feature: "trainer_clients",
      currentTier: "free",
      upgradeTo: "individual_trainer",
      upgradePriceMonthly: 14.99,
      blockedAt: "2026-05-24T10:01:00.000Z",
    });
    enqueueAndBlock(storage, {
      feature: "trainer_clients",
      currentTier: "free",
      upgradeTo: "small_business",
      upgradePriceMonthly: 29.99,
      blockedAt: "2026-05-24T10:02:00.000Z",
    });
    renderMount(adapters);
    expect(screen.getByText(/Upgrade to Individual Trainer/)).toBeTruthy();
  });
});
