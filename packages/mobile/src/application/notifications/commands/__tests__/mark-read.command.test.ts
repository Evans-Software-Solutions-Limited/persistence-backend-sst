import { markNotificationReadCommand } from "@/application/notifications/commands/mark-read.command";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import { makeNotification } from "@/application/notifications/__tests__/notification.fixture";

describe("markNotificationReadCommand", () => {
  const CLOCK = () => "2026-06-05T12:00:00.000Z";

  it("optimistically marks the cached row read and enqueues a PATCH", () => {
    const storage = new InMemoryStorageAdapter();
    storage.cacheNotifications([makeNotification({ id: "n-1", readAt: null })]);

    markNotificationReadCommand(storage, "n-1", CLOCK);

    expect(storage.getCachedNotifications()[0].readAt).toBe(
      "2026-06-05T12:00:00.000Z",
    );
    const queued = storage.getPendingMutations();
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({
      entityType: "notification",
      entityId: "n-1",
      operation: "update",
      endpoint: "/notifications/n-1",
      method: "PATCH",
    });
    expect(JSON.parse(queued[0].payload)).toEqual({ isRead: true });
  });

  it("uses the wall-clock by default when no clock is injected", () => {
    const storage = new InMemoryStorageAdapter();
    storage.cacheNotifications([makeNotification({ id: "n-1", readAt: null })]);

    markNotificationReadCommand(storage, "n-1");

    const readAt = storage.getCachedNotifications()[0].readAt;
    expect(readAt).not.toBeNull();
    expect(Number.isNaN(Date.parse(readAt as string))).toBe(false);
  });

  it("preserves the original read moment on an already-read row (COALESCE)", () => {
    const storage = new InMemoryStorageAdapter();
    storage.cacheNotifications([
      makeNotification({ id: "n-1", readAt: "2026-06-01T00:00:00.000Z" }),
    ]);

    markNotificationReadCommand(storage, "n-1", CLOCK);

    expect(storage.getCachedNotifications()[0].readAt).toBe(
      "2026-06-01T00:00:00.000Z",
    );
  });
});
