import {
  getUnreadCountQuery,
  refreshUnreadCount,
} from "@/application/notifications/queries/unread-count.query";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import { makeNotification } from "@/application/notifications/__tests__/notification.fixture";

describe("unread-count.query", () => {
  describe("getUnreadCountQuery", () => {
    it("derives the count from cached unread rows", () => {
      const storage = new InMemoryStorageAdapter();
      storage.cacheNotifications([
        makeNotification({ id: "a", readAt: null }),
        makeNotification({ id: "b", readAt: "2026-06-02T00:00:00.000Z" }),
        makeNotification({ id: "c", readAt: null }),
      ]);
      expect(getUnreadCountQuery(storage)).toBe(2);
    });

    it("returns 0 for an empty cache", () => {
      expect(getUnreadCountQuery(new InMemoryStorageAdapter())).toBe(0);
    });
  });

  describe("refreshUnreadCount", () => {
    it("returns the server-authoritative count on success", async () => {
      const api = new InMemoryApiAdapter();
      const storage = new InMemoryStorageAdapter();
      api.notificationsUnreadCount = 42;
      const result = await refreshUnreadCount(api, storage);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toBe(42);
      // count-only refresh fetches a single row
      expect(api.getNotificationsCalls).toContainEqual({ limit: 1 });
    });

    it("propagates API failure", async () => {
      const api = new InMemoryApiAdapter();
      const storage = new InMemoryStorageAdapter();
      api.shouldFail = true;
      const result = await refreshUnreadCount(api, storage);
      expect(result.ok).toBe(false);
    });
  });
});
