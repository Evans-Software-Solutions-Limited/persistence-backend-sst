import {
  getNotificationsQuery,
  refreshNotifications,
} from "@/application/notifications/queries/list-notifications.query";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import { makeNotification } from "@/application/notifications/__tests__/notification.fixture";

describe("list-notifications.query", () => {
  describe("getNotificationsQuery", () => {
    it("returns empty list + zero unread when cache is empty", () => {
      const storage = new InMemoryStorageAdapter();
      const result = getNotificationsQuery(storage);
      expect(result.notifications).toEqual([]);
      expect(result.unreadCount).toBe(0);
    });

    it("returns cached rows newest-first with derived unread count", () => {
      const storage = new InMemoryStorageAdapter();
      storage.cacheNotifications([
        makeNotification({ id: "old", createdAt: "2026-06-01T00:00:00.000Z" }),
        makeNotification({
          id: "new",
          createdAt: "2026-06-02T00:00:00.000Z",
          readAt: "2026-06-02T01:00:00.000Z",
        }),
      ]);
      const result = getNotificationsQuery(storage);
      expect(result.notifications.map((n) => n.id)).toEqual(["new", "old"]);
      expect(result.unreadCount).toBe(1); // only "old" is unread
    });

    it("caps the read at the requested limit", () => {
      const storage = new InMemoryStorageAdapter();
      storage.cacheNotifications([
        makeNotification({ id: "a", createdAt: "2026-06-03T00:00:00.000Z" }),
        makeNotification({ id: "b", createdAt: "2026-06-02T00:00:00.000Z" }),
        makeNotification({ id: "c", createdAt: "2026-06-01T00:00:00.000Z" }),
      ]);
      const result = getNotificationsQuery(storage, 2);
      expect(result.notifications.map((n) => n.id)).toEqual(["a", "b"]);
    });
  });

  describe("refreshNotifications", () => {
    it("writes rows through to the cache and returns the page on success", async () => {
      const api = new InMemoryApiAdapter();
      const storage = new InMemoryStorageAdapter();
      api.notifications = [makeNotification({ id: "x" })];
      api.notificationsNextCursor = "cursor-2";
      api.notificationsUnreadCount = 5;

      const result = await refreshNotifications(api, storage);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.nextCursor).toBe("cursor-2");
      expect(result.value.unreadCount).toBe(5);
      expect(storage.getCachedNotifications().map((n) => n.id)).toEqual(["x"]);
    });

    it("forwards pagination params to the API", async () => {
      const api = new InMemoryApiAdapter();
      const storage = new InMemoryStorageAdapter();
      await refreshNotifications(api, storage, {
        cursor: "c1",
        limit: 20,
        unreadOnly: true,
      });
      expect(api.getNotificationsCalls).toContainEqual({
        cursor: "c1",
        limit: 20,
        unreadOnly: true,
      });
    });

    it("leaves the cache untouched on API failure", async () => {
      const api = new InMemoryApiAdapter();
      const storage = new InMemoryStorageAdapter();
      storage.cacheNotifications([makeNotification({ id: "kept" })]);
      api.shouldFail = true;

      const result = await refreshNotifications(api, storage);
      expect(result.ok).toBe(false);
      expect(storage.getCachedNotifications().map((n) => n.id)).toEqual([
        "kept",
      ]);
    });
  });
});
