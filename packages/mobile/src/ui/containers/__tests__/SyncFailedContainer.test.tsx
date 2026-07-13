import {
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react-native";
import type { ReactNode } from "react";
import { Alert } from "react-native";

jest.mock("@/adapters/api", () => ({
  ...jest.requireActual("@/adapters/api"),
  getApiBaseUrl: () => "https://api.test",
}));

const mockProcessSyncQueue = jest.fn();
jest.mock("@/application/commands/sync.command", () => ({
  ...jest.requireActual("@/application/commands/sync.command"),
  processSyncQueue: (...args: unknown[]) => mockProcessSyncQueue(...args),
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
import { SyncFailedContainer } from "@/ui/containers/SyncFailedContainer";

function makeAdapters(): {
  adapters: Adapters;
  storage: InMemoryStorageAdapter;
} {
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

function renderContainer(adapters: Adapters) {
  function TestWrapper({ children }: { children: ReactNode }) {
    return <AdapterProvider adapters={adapters}>{children}</AdapterProvider>;
  }
  return render(
    <TestWrapper>
      <SyncFailedContainer />
    </TestWrapper>,
  );
}

function enqueueAndExhaust(
  storage: InMemoryStorageAdapter,
  entityType = "workout",
): number {
  storage.enqueueMutation({
    entityType,
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

describe("SyncFailedContainer", () => {
  beforeEach(() => {
    mockProcessSyncQueue.mockReset();
    mockProcessSyncQueue.mockResolvedValue({
      processed: 0,
      succeeded: 0,
      failed: 0,
      blocked: 0,
    });
  });

  it("renders the empty state when no entries have failed", () => {
    const { adapters } = makeAdapters();
    renderContainer(adapters);
    expect(screen.getByTestId("sync-failed-empty")).toBeTruthy();
  });

  it("renders one card per failed-exhausted entry", () => {
    const { adapters, storage } = makeAdapters();
    const id1 = enqueueAndExhaust(storage);
    const id2 = enqueueAndExhaust(storage);
    renderContainer(adapters);
    expect(screen.getByTestId(`sync-failed-entry-${id1}`)).toBeTruthy();
    expect(screen.getByTestId(`sync-failed-entry-${id2}`)).toBeTruthy();
  });

  it("Retry resets the entry to pending and triggers a flush", async () => {
    const { adapters, storage } = makeAdapters();
    const id = enqueueAndExhaust(storage);
    renderContainer(adapters);

    fireEvent.press(screen.getByTestId(`sync-failed-retry-${id}`));

    // Immediately reset — the card leaves the failed list synchronously.
    expect(storage.getFailedExhaustedEntries()).toHaveLength(0);

    await waitFor(() => expect(mockProcessSyncQueue).toHaveBeenCalledTimes(1));
    expect(mockProcessSyncQueue).toHaveBeenCalledWith(
      storage,
      adapters.auth,
      "https://api.test",
    );
  });

  it("Retry's flush failure is non-fatal — the entry stays reset to pending", async () => {
    const consoleSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => {});
    mockProcessSyncQueue.mockReset();
    mockProcessSyncQueue.mockRejectedValue(new Error("network down"));

    const { adapters, storage } = makeAdapters();
    const id = enqueueAndExhaust(storage);
    renderContainer(adapters);

    fireEvent.press(screen.getByTestId(`sync-failed-retry-${id}`));

    await waitFor(() => expect(mockProcessSyncQueue).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(consoleSpy).toHaveBeenCalledWith(
        "[SyncFailedContainer] retry flush failed:",
        expect.any(Error),
      ),
    );
    // The entry was already reset to pending before the flush attempt —
    // a failed best-effort flush doesn't re-strand it.
    expect(storage.getFailedExhaustedEntries()).toHaveLength(0);
    consoleSpy.mockRestore();
  });

  it("Discard CTA shows a confirmation Alert and removes the entry on confirm", async () => {
    const alertSpy = jest
      .spyOn(Alert, "alert")
      .mockImplementation((_t, _m, buttons) => {
        const destructive = buttons?.find((b) => b.style === "destructive");
        destructive?.onPress?.();
      });

    const { adapters, storage } = makeAdapters();
    const id = enqueueAndExhaust(storage, "workout");
    renderContainer(adapters);

    fireEvent.press(screen.getByTestId(`sync-failed-discard-${id}`));

    expect(alertSpy).toHaveBeenCalledWith(
      "Discard this item?",
      expect.stringContaining("will be removed from your sync queue"),
      expect.any(Array),
    );
    await waitFor(() => {
      expect(storage.getFailedExhaustedEntries()).toHaveLength(0);
    });
    alertSpy.mockRestore();
  });

  it("Discard warns about permanent loss when the entry is a completed session", () => {
    const alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    const { adapters, storage } = makeAdapters();
    const id = enqueueAndExhaust(storage, "session");
    renderContainer(adapters);

    fireEvent.press(screen.getByTestId(`sync-failed-discard-${id}`));

    expect(alertSpy).toHaveBeenCalledWith(
      "Discard this item?",
      expect.stringContaining("that workout is lost"),
      expect.any(Array),
    );
    alertSpy.mockRestore();
  });

  it("Discard CTA's Cancel button does NOT remove the entry", () => {
    const alertSpy = jest
      .spyOn(Alert, "alert")
      .mockImplementation((_t, _m, buttons) => {
        const cancel = buttons?.find((b) => b.style === "cancel");
        cancel?.onPress?.();
      });

    const { adapters, storage } = makeAdapters();
    const id = enqueueAndExhaust(storage);
    renderContainer(adapters);

    fireEvent.press(screen.getByTestId(`sync-failed-discard-${id}`));
    expect(storage.getFailedExhaustedEntries()).toHaveLength(1);
    alertSpy.mockRestore();
  });
});
