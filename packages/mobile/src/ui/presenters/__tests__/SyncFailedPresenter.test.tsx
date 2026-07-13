import { fireEvent, render, screen } from "@testing-library/react-native";
import type { SyncQueueEntry } from "@/domain/ports/storage.port";
import { SyncFailedPresenter } from "@/ui/presenters/SyncFailedPresenter";

function makeEntry(overrides: Partial<SyncQueueEntry> = {}): SyncQueueEntry {
  return {
    id: 1,
    entityType: "workout",
    entityId: "w-1",
    operation: "create",
    payload: "{}",
    endpoint: "/workouts",
    method: "POST",
    status: "failed",
    retryCount: 3,
    maxRetries: 3,
    errorMessage: "HTTP 500: boom",
    createdAt: "2026-05-23T10:00:00.000Z",
    entitlementVerdict: null,
    ...overrides,
  };
}

describe("SyncFailedPresenter", () => {
  it("renders the empty state when no entries are present", () => {
    render(
      <SyncFailedPresenter
        entries={[]}
        onRetry={jest.fn()}
        onDiscard={jest.fn()}
      />,
    );
    expect(screen.getByTestId("sync-failed-empty")).toBeTruthy();
    expect(screen.getByText(/All clear/i)).toBeTruthy();
  });

  it("renders one card per entry with its entityType + date + error message", () => {
    const entries = [
      makeEntry({ id: 1, entityType: "session" }),
      makeEntry({ id: 2, entityType: "workout" }),
    ];
    render(
      <SyncFailedPresenter
        entries={entries}
        onRetry={jest.fn()}
        onDiscard={jest.fn()}
      />,
    );
    expect(screen.getByTestId("sync-failed-entry-1")).toBeTruthy();
    expect(screen.getByTestId("sync-failed-entry-2")).toBeTruthy();
    expect(screen.getByText("session from 2026-05-23")).toBeTruthy();
    expect(screen.getByText("workout from 2026-05-23")).toBeTruthy();
    expect(screen.getAllByText("HTTP 500: boom")).toHaveLength(2);
  });

  it("omits the error line when errorMessage is null", () => {
    render(
      <SyncFailedPresenter
        entries={[makeEntry({ errorMessage: null })]}
        onRetry={jest.fn()}
        onDiscard={jest.fn()}
      />,
    );
    expect(screen.queryByText(/HTTP/)).toBeNull();
  });

  it("fires onRetry with the entry when Retry is tapped", () => {
    const onRetry = jest.fn();
    const entry = makeEntry({ id: 7 });
    render(
      <SyncFailedPresenter
        entries={[entry]}
        onRetry={onRetry}
        onDiscard={jest.fn()}
      />,
    );
    fireEvent.press(screen.getByTestId("sync-failed-retry-7"));
    expect(onRetry).toHaveBeenCalledWith(entry);
  });

  it("fires onDiscard with the entry when Discard is tapped", () => {
    const onDiscard = jest.fn();
    const entry = makeEntry({ id: 7 });
    render(
      <SyncFailedPresenter
        entries={[entry]}
        onRetry={jest.fn()}
        onDiscard={onDiscard}
      />,
    );
    fireEvent.press(screen.getByTestId("sync-failed-discard-7"));
    expect(onDiscard).toHaveBeenCalledWith(entry);
  });
});
