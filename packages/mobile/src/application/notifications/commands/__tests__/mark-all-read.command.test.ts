import { markAllNotificationsReadCommand } from "@/application/notifications/commands/mark-all-read.command";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import { makeNotification } from "@/application/notifications/__tests__/notification.fixture";

describe("markAllNotificationsReadCommand", () => {
  const CLOCK = () => "2026-06-05T12:00:00.000Z";

  it("marks every cached unread row read and enqueues a PATCH /all", () => {
    const storage = new InMemoryStorageAdapter();
    storage.cacheNotifications([
      makeNotification({ id: "a", readAt: null }),
      makeNotification({ id: "b", readAt: "2026-06-01T00:00:00.000Z" }),
      makeNotification({ id: "c", readAt: null }),
    ]);

    markAllNotificationsReadCommand(storage, CLOCK);

    expect(storage.getCachedUnreadCount()).toBe(0);
    // already-read row keeps its original moment
    const b = storage.getCachedNotifications().find((n) => n.id === "b");
    expect(b?.readAt).toBe("2026-06-01T00:00:00.000Z");

    const queued = storage.getPendingMutations();
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({
      entityType: "notification",
      operation: "update",
      endpoint: "/notifications/all",
      method: "PATCH",
    });
    expect(JSON.parse(queued[0].payload)).toEqual({});
  });

  it("uses the wall-clock by default when no clock is injected", () => {
    const storage = new InMemoryStorageAdapter();
    storage.cacheNotifications([makeNotification({ id: "a", readAt: null })]);

    markAllNotificationsReadCommand(storage);

    const readAt = storage.getCachedNotifications()[0].readAt;
    expect(readAt).not.toBeNull();
    expect(Number.isNaN(Date.parse(readAt as string))).toBe(false);
  });
});
