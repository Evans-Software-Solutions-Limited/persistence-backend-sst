import { renderHook, act, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryAuthAdapter } from "@/adapters/auth/__tests__/in-memory-auth.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import { StubHealthAdapter } from "@/adapters/health";
import { StubNotificationsAdapter } from "@/adapters/notifications";
import { MockPaymentsAdapter } from "@/adapters/payments/__tests__/mock.adapter";
import { InMemoryNetInfoAdapter } from "@/adapters/netInfo/__tests__/InMemoryNetInfoAdapter";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import type { EntitlementVerdict } from "@/domain/ports/sync.types";
import {
  BLOCKED_SYNC_POLL_INTERVAL_MS,
  useBlockedSyncEntries,
} from "@/ui/hooks/useBlockedSyncEntries";

function wrapper(adapters: Adapters) {
  function TestWrapper({ children }: { children: ReactNode }) {
    return <AdapterProvider adapters={adapters}>{children}</AdapterProvider>;
  }
  return TestWrapper;
}

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

const VERDICT_WORKOUT: EntitlementVerdict = {
  feature: "create_workout",
  currentTier: "premium",
  upgradeTo: "premium",
  upgradePriceMonthly: 12.99,
  blockedAt: "2026-05-24T10:00:00.000Z",
};

const VERDICT_AI: EntitlementVerdict = {
  feature: "ai_workout",
  currentTier: "premium",
  upgradeTo: "premium",
  upgradePriceMonthly: 12.99,
  blockedAt: "2026-05-24T11:00:00.000Z",
};

function enqueueAndBlock(
  storage: InMemoryStorageAdapter,
  verdict: EntitlementVerdict,
): void {
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

describe("useBlockedSyncEntries", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("returns an empty summary when no entries are blocked", () => {
    const { adapters } = makeAdapters();
    const { result } = renderHook(() => useBlockedSyncEntries(), {
      wrapper: wrapper(adapters),
    });
    expect(result.current.total).toBe(0);
    expect(result.current.byFeature).toEqual({});
    expect(result.current.earliestBlockedAt).toBeNull();
    expect(result.current.entries).toEqual([]);
  });

  it("counts blocked entries and groups by feature", () => {
    const { adapters, storage } = makeAdapters();
    enqueueAndBlock(storage, VERDICT_WORKOUT);
    enqueueAndBlock(storage, VERDICT_WORKOUT);
    enqueueAndBlock(storage, VERDICT_AI);

    const { result } = renderHook(() => useBlockedSyncEntries(), {
      wrapper: wrapper(adapters),
    });
    expect(result.current.total).toBe(3);
    expect(result.current.byFeature).toEqual({
      create_workout: 2,
      ai_workout: 1,
    });
    expect(result.current.entries).toHaveLength(3);
  });

  it("surfaces the earliest blockedAt across all entries", () => {
    const { adapters, storage } = makeAdapters();
    enqueueAndBlock(storage, VERDICT_AI); // 11:00
    enqueueAndBlock(storage, VERDICT_WORKOUT); // 10:00 (earlier)

    const { result } = renderHook(() => useBlockedSyncEntries(), {
      wrapper: wrapper(adapters),
    });
    expect(result.current.earliestBlockedAt).toBe("2026-05-24T10:00:00.000Z");
  });

  it("refresh() re-reads storage on demand without waiting for the poll", () => {
    const { adapters, storage } = makeAdapters();
    const { result } = renderHook(() => useBlockedSyncEntries(), {
      wrapper: wrapper(adapters),
    });
    expect(result.current.total).toBe(0);

    enqueueAndBlock(storage, VERDICT_WORKOUT);
    act(() => {
      result.current.refresh();
    });
    expect(result.current.total).toBe(1);
  });

  it("re-reads storage on the polling interval", async () => {
    const { adapters, storage } = makeAdapters();
    const { result } = renderHook(() => useBlockedSyncEntries(), {
      wrapper: wrapper(adapters),
    });
    expect(result.current.total).toBe(0);

    enqueueAndBlock(storage, VERDICT_WORKOUT);
    act(() => {
      jest.advanceTimersByTime(BLOCKED_SYNC_POLL_INTERVAL_MS);
    });
    await waitFor(() => expect(result.current.total).toBe(1));
  });

  it("exposes the polling interval constant so tests + ops can reason about cadence", () => {
    expect(BLOCKED_SYNC_POLL_INTERVAL_MS).toBe(30_000);
  });

  // Inspector Brad PR #73 low-severity find — sweep #3. Pre-fix, a
  // verdict-less row (legacy install: column ALTER landed but verdict
  // failed to decode) was counted in `total` but rendered nothing on the
  // review screen, so the banner said "5 items" while only 4 cards
  // showed up. Fix filters total + byFeature + earliest to verdict-only
  // rows so the count matches what the user can actually act on.
  it("excludes verdict-less rows from total + byFeature + earliest", () => {
    const { adapters, storage } = makeAdapters();
    enqueueAndBlock(storage, VERDICT_WORKOUT);

    // Inject a verdict-less blocked row by stubbing getBlockedEntries on
    // the same adapter — simulates a legacy decode failure that left the
    // row at status='blocked_entitlement' but with entitlementVerdict=null.
    const valid = storage.getBlockedEntries()[0];
    jest.spyOn(storage, "getBlockedEntries").mockReturnValue([
      valid,
      {
        ...valid,
        id: valid.id + 1,
        entitlementVerdict: null,
      },
    ]);

    const { result } = renderHook(() => useBlockedSyncEntries(), {
      wrapper: wrapper(adapters),
    });
    // Only the verdict-bearing row is counted.
    expect(result.current.total).toBe(1);
    expect(result.current.byFeature).toEqual({ create_workout: 1 });
    expect(result.current.entries).toHaveLength(1);
    expect(result.current.earliestBlockedAt).toBe(VERDICT_WORKOUT.blockedAt);
  });
});
