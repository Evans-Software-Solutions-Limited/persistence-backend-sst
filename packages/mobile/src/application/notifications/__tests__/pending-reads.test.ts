import {
  applyPendingReads,
  isPendingRead,
  optimisticBadgeCount,
  optimisticUnread,
  pendingReadState,
} from "@/application/notifications/pending-reads";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import { makeNotification } from "@/application/notifications/__tests__/notification.fixture";
import type { StoragePort } from "@/domain/ports/storage.port";

function markReadEntry(storage: InMemoryStorageAdapter, id: string) {
  storage.enqueueMutation({
    entityType: "notification",
    entityId: id,
    operation: "update",
    payload: { isRead: true },
    endpoint: `/notifications/${id}`,
    method: "PATCH",
  });
}

function markAllEntry(storage: InMemoryStorageAdapter) {
  storage.enqueueMutation({
    entityType: "notification",
    operation: "update",
    payload: {},
    endpoint: "/notifications/all",
    method: "PATCH",
  });
}

describe("pendingReadState", () => {
  it("collects individual mark-read ids and a mark-all flag", () => {
    const storage = new InMemoryStorageAdapter();
    markReadEntry(storage, "a");
    markReadEntry(storage, "b");
    const before = pendingReadState(storage);
    expect(before.markAllAt).toBeNull();
    expect([...before.ids].sort()).toEqual(["a", "b"]);

    markAllEntry(storage);
    const after = pendingReadState(storage);
    expect(after.markAllAt).not.toBeNull();
  });

  it("keeps the LATEST timestamp across multiple un-flushed mark-alls", () => {
    // Two queued mark-alls (e.g. user tapped twice before a flush). markAllAt
    // must advance to the later one so the read window covers everything up
    // to the most recent mark-all (exercises the `createdAt > markAllAt` arm).
    const stub: Pick<StoragePort, "getPendingMutations"> = {
      getPendingMutations: () =>
        [
          {
            id: 1,
            entityType: "notification",
            entityId: null,
            operation: "update",
            payload: "{}",
            endpoint: "/notifications/all",
            method: "PATCH",
            status: "pending",
            retryCount: 0,
            maxRetries: 3,
            errorMessage: null,
            createdAt: "2026-06-09T10:00:00.000Z",
            entitlementVerdict: null,
          },
          {
            id: 2,
            entityType: "notification",
            entityId: null,
            operation: "update",
            payload: "{}",
            endpoint: "/notifications/all",
            method: "PATCH",
            status: "pending",
            retryCount: 0,
            maxRetries: 3,
            errorMessage: null,
            createdAt: "2026-06-09T12:00:00.000Z",
            entitlementVerdict: null,
          },
        ] as ReturnType<StoragePort["getPendingMutations"]>,
    };
    expect(pendingReadState(stub as StoragePort).markAllAt).toBe(
      "2026-06-09T12:00:00.000Z",
    );
  });
});

describe("isPendingRead", () => {
  it("matches individually-marked ids", () => {
    expect(
      isPendingRead(makeNotification({ id: "x" }), null, new Set(["x"])),
    ).toBe(true);
    expect(
      isPendingRead(makeNotification({ id: "y" }), null, new Set(["x"])),
    ).toBe(false);
  });

  it("treats a SQLite-format mark-all timestamp (no T/Z) as UTC (Inspector #83)", () => {
    // sync_queue.created_at default is `datetime('now')` → 'YYYY-MM-DD HH:MM:SS'
    // UTC text. A naive Date.parse reads it as LOCAL, mis-bucketing arrivals
    // by the device's UTC offset. parseUtc must treat it as UTC.
    const markAllAt = "2026-06-09 18:00:00"; // 18:00 UTC
    const justBefore = makeNotification({
      id: "old",
      createdAt: "2026-06-09T17:59:00.000Z",
    });
    const justAfter = makeNotification({
      id: "new",
      createdAt: "2026-06-09T18:01:00.000Z",
    });
    expect(isPendingRead(justBefore, markAllAt, new Set())).toBe(true);
    expect(isPendingRead(justAfter, markAllAt, new Set())).toBe(false);
  });

  it("also handles an ISO mark-all timestamp", () => {
    const markAllAt = "2026-06-09T18:00:00.000Z";
    expect(
      isPendingRead(
        makeNotification({ createdAt: "2026-06-09T17:00:00.000Z" }),
        markAllAt,
        new Set(),
      ),
    ).toBe(true);
  });
});

describe("applyPendingReads", () => {
  it("flips matching unread rows to read, leaves post-mark-all arrivals unread", () => {
    const storage = new InMemoryStorageAdapter();
    markAllEntry(storage);
    const at = pendingReadState(storage).markAllAt!;
    const before = new Date(Date.parse(at) - 60_000).toISOString();
    const after = new Date(Date.parse(at) + 60_000).toISOString();
    const out = applyPendingReads(
      [
        makeNotification({ id: "old", createdAt: before, readAt: null }),
        makeNotification({ id: "new", createdAt: after, readAt: null }),
      ],
      storage,
      "2026-06-09T20:00:00.000Z",
    );
    expect(out.find((n) => n.id === "old")?.readAt).toBe(
      "2026-06-09T20:00:00.000Z",
    );
    expect(out.find((n) => n.id === "new")?.readAt).toBeNull();
  });
});

describe("optimisticUnread", () => {
  it("subtracts individually-pending reads from the server total", () => {
    const storage = new InMemoryStorageAdapter();
    markReadEntry(storage, "a");
    markReadEntry(storage, "b");
    expect(optimisticUnread(5, [], storage)).toBe(3);
  });

  it("with a pending mark-all, counts only the page's still-unread rows", () => {
    const storage = new InMemoryStorageAdapter();
    markAllEntry(storage);
    const page = [
      makeNotification({ id: "r", readAt: "2026-06-09T00:00:00.000Z" }),
      makeNotification({ id: "u", readAt: null }),
    ];
    expect(optimisticUnread(9, page, storage)).toBe(1);
  });
});

describe("optimisticBadgeCount", () => {
  it("subtracts individually-pending reads from the server total", () => {
    const storage = new InMemoryStorageAdapter();
    markReadEntry(storage, "a");
    expect(optimisticBadgeCount(4, storage)).toBe(3);
  });

  it("with a pending mark-all, uses the (optimistic) cache count, not the server total", () => {
    const storage = new InMemoryStorageAdapter();
    // Cache reflects the optimistic mark-all (all rows read) → 0 unread.
    storage.cacheNotifications([
      makeNotification({ id: "a", readAt: "2026-06-09T00:00:00.000Z" }),
    ]);
    markAllEntry(storage);
    // Server still reports 3 unread (mark-all not flushed) — must NOT clobber.
    expect(optimisticBadgeCount(3, storage)).toBe(0);
  });
});
