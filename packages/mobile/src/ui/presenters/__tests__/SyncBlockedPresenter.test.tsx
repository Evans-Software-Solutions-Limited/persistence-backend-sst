import { fireEvent, render, screen } from "@testing-library/react-native";
import type { SyncQueueEntry } from "@/domain/ports/storage.port";
import {
  SyncBlockedPresenter,
  type SyncBlockedGroup,
} from "@/ui/presenters/SyncBlockedPresenter";

function makeEntry(overrides: Partial<SyncQueueEntry> = {}): SyncQueueEntry {
  return {
    id: 1,
    entityType: "workout",
    entityId: "w-1",
    operation: "create",
    payload: "{}",
    endpoint: "/workouts",
    method: "POST",
    status: "blocked_entitlement",
    retryCount: 0,
    maxRetries: 3,
    errorMessage: null,
    createdAt: "2026-05-23T10:00:00.000Z",
    entitlementVerdict: {
      feature: "create_workout",
      currentTier: "basic",
      upgradeTo: "premium",
      upgradePriceMonthly: 12.99,
      blockedAt: "2026-05-24T10:00:00.000Z",
    },
    ...overrides,
  };
}

describe("SyncBlockedPresenter", () => {
  it("renders the empty state when no groups are present", () => {
    render(
      <SyncBlockedPresenter
        groups={[]}
        onUpgrade={jest.fn()}
        onDiscardGroup={jest.fn()}
        onContactSupport={jest.fn()}
      />,
    );
    expect(screen.getByTestId("sync-blocked-empty")).toBeTruthy();
    expect(screen.getByText(/All clear/i)).toBeTruthy();
  });

  it("renders one card per group with the right tier label + item count + price", () => {
    const groups: SyncBlockedGroup[] = [
      {
        key: "premium",
        upgradeTo: "premium",
        upgradePriceMonthly: 12.99,
        entries: [makeEntry({ id: 1 }), makeEntry({ id: 2 })],
      },
    ];
    render(
      <SyncBlockedPresenter
        groups={groups}
        onUpgrade={jest.fn()}
        onDiscardGroup={jest.fn()}
        onContactSupport={jest.fn()}
      />,
    );
    expect(screen.getByTestId("sync-blocked-group-premium")).toBeTruthy();
    expect(screen.getByText("Requires Premium")).toBeTruthy();
    expect(screen.getByText("2 items")).toBeTruthy();
    expect(screen.getByText("£12.99/month")).toBeTruthy();
  });

  it("fires onUpgrade with the group when the upgrade CTA is tapped", () => {
    const onUpgrade = jest.fn();
    const group: SyncBlockedGroup = {
      key: "premium",
      upgradeTo: "premium",
      upgradePriceMonthly: 12.99,
      entries: [makeEntry()],
    };
    render(
      <SyncBlockedPresenter
        groups={[group]}
        onUpgrade={onUpgrade}
        onDiscardGroup={jest.fn()}
        onContactSupport={jest.fn()}
      />,
    );
    fireEvent.press(screen.getByTestId("sync-blocked-upgrade-premium"));
    expect(onUpgrade).toHaveBeenCalledWith(group);
  });

  it("fires onDiscardGroup with the group when the discard CTA is tapped", () => {
    const onDiscardGroup = jest.fn();
    const group: SyncBlockedGroup = {
      key: "premium",
      upgradeTo: "premium",
      upgradePriceMonthly: 12.99,
      entries: [makeEntry()],
    };
    render(
      <SyncBlockedPresenter
        groups={[group]}
        onUpgrade={jest.fn()}
        onDiscardGroup={onDiscardGroup}
        onContactSupport={jest.fn()}
      />,
    );
    fireEvent.press(screen.getByTestId("sync-blocked-discard-premium"));
    expect(onDiscardGroup).toHaveBeenCalledWith(group);
  });

  it("renders Contact support CTA when upgradeTo is null", () => {
    const onContactSupport = jest.fn();
    const group: SyncBlockedGroup = {
      key: "no-upgrade",
      upgradeTo: null,
      upgradePriceMonthly: null,
      entries: [
        makeEntry({
          entitlementVerdict: {
            feature: "trainer_clients",
            currentTier: "individual_trainer_pro",
            upgradeTo: null,
            upgradePriceMonthly: null,
            blockedAt: "2026-05-24T10:00:00.000Z",
          },
        }),
      ],
    };
    render(
      <SyncBlockedPresenter
        groups={[group]}
        onUpgrade={jest.fn()}
        onDiscardGroup={jest.fn()}
        onContactSupport={onContactSupport}
      />,
    );
    expect(screen.queryByTestId("sync-blocked-upgrade-no-upgrade")).toBeNull();
    expect(screen.getByText(/Already at the top tier/)).toBeTruthy();
    fireEvent.press(screen.getByTestId("sync-blocked-contact-no-upgrade"));
    expect(onContactSupport).toHaveBeenCalledTimes(1);
  });

  it("uses singular wording for a group with exactly 1 entry", () => {
    const group: SyncBlockedGroup = {
      key: "premium",
      upgradeTo: "premium",
      upgradePriceMonthly: 12.99,
      entries: [makeEntry()],
    };
    render(
      <SyncBlockedPresenter
        groups={[group]}
        onUpgrade={jest.fn()}
        onDiscardGroup={jest.fn()}
        onContactSupport={jest.fn()}
      />,
    );
    expect(screen.getByText("1 item")).toBeTruthy();
  });

  it("omits the price line when upgradePriceMonthly is null", () => {
    const group: SyncBlockedGroup = {
      key: "premium",
      upgradeTo: "premium",
      upgradePriceMonthly: null,
      entries: [makeEntry()],
    };
    render(
      <SyncBlockedPresenter
        groups={[group]}
        onUpgrade={jest.fn()}
        onDiscardGroup={jest.fn()}
        onContactSupport={jest.fn()}
      />,
    );
    expect(screen.queryByText(/£/)).toBeNull();
  });
});
