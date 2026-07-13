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
import type { Adapters } from "@/shared/types";
// eslint-disable-next-line import/first
import { AdapterProvider } from "@/ui/hooks/useAdapters";
// eslint-disable-next-line import/first
import { SyncFailedBannerMount } from "@/ui/containers/SyncFailedBannerMount";

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
      <SyncFailedBannerMount />
    </TestWrapper>,
  );
}

function enqueueAndExhaust(storage: InMemoryStorageAdapter): number {
  storage.enqueueMutation({
    entityType: "workout",
    operation: "create",
    payload: {},
    endpoint: "/workouts",
    method: "POST",
  });
  const id = storage.getPendingMutations().slice(-1)[0].id;
  storage.markMutationFailed(id, "e1");
  storage.markMutationFailed(id, "e2");
  storage.markMutationFailed(id, "e3");
  return id;
}

describe("SyncFailedBannerMount", () => {
  beforeEach(() => mockPush.mockReset());

  it("renders nothing when no entries have failed", () => {
    const { adapters } = makeAdapters();
    renderMount(adapters);
    expect(screen.queryByTestId("sync-failed-banner")).toBeNull();
  });

  it("renders the banner with the count when entries have failed", () => {
    const { adapters, storage } = makeAdapters();
    enqueueAndExhaust(storage);
    enqueueAndExhaust(storage);
    renderMount(adapters);
    expect(screen.getByTestId("sync-failed-banner")).toBeTruthy();
    expect(screen.getByText(/2 items failed to sync/)).toBeTruthy();
  });

  it("routes Review tap to /(app)/sync-failed", () => {
    const { adapters, storage } = makeAdapters();
    enqueueAndExhaust(storage);
    renderMount(adapters);
    fireEvent.press(screen.getByTestId("sync-failed-banner-review"));
    expect(mockPush).toHaveBeenCalledWith("/(app)/sync-failed");
  });
});
