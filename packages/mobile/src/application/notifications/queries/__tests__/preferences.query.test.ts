import {
  getPreferencesQuery,
  refreshPreferences,
} from "@/application/notifications/queries/preferences.query";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";

describe("preferences.query", () => {
  describe("getPreferencesQuery", () => {
    it("returns null when nothing is cached yet", () => {
      expect(getPreferencesQuery(new InMemoryStorageAdapter())).toBeNull();
    });

    it("returns the cached map when present", () => {
      const storage = new InMemoryStorageAdapter();
      storage.cacheNotificationPreferences({ workout_assigned: false });
      expect(getPreferencesQuery(storage)).toEqual({
        workout_assigned: false,
      });
    });
  });

  describe("refreshPreferences", () => {
    it("writes the map through to the cache on success", async () => {
      const api = new InMemoryApiAdapter();
      const storage = new InMemoryStorageAdapter();
      api.notificationPreferences = { goal_milestone: false };
      const result = await refreshPreferences(api, storage);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toEqual({ goal_milestone: false });
      expect(storage.getCachedNotificationPreferences()).toEqual({
        goal_milestone: false,
      });
    });

    it("leaves the cache untouched on API failure", async () => {
      const api = new InMemoryApiAdapter();
      const storage = new InMemoryStorageAdapter();
      storage.cacheNotificationPreferences({ workout_assigned: true });
      api.shouldFail = true;
      const result = await refreshPreferences(api, storage);
      expect(result.ok).toBe(false);
      expect(storage.getCachedNotificationPreferences()).toEqual({
        workout_assigned: true,
      });
    });

    it("re-applies un-flushed optimistic toggles on top of the server map (#10)", async () => {
      const api = new InMemoryApiAdapter();
      const storage = new InMemoryStorageAdapter();
      storage.initialize();
      // Server still has the old value; the user has optimistically toggled
      // goal_milestone OFF (queued, not flushed).
      api.notificationPreferences = {
        goal_milestone: true,
        workout_assigned: true,
      };
      // An unrelated pending mutation must be ignored by the merge.
      storage.enqueueMutation({
        entityType: "notification",
        entityId: "n1",
        operation: "update",
        payload: { isRead: true },
        endpoint: "/notifications/n1",
        method: "PATCH",
      });
      storage.enqueueMutation({
        entityType: "notification-preferences",
        operation: "update",
        payload: { goal_milestone: false },
        endpoint: "/notifications/preferences",
        method: "POST",
      });

      const result = await refreshPreferences(api, storage);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // The in-flight refresh must NOT revert the pending toggle.
      expect(result.value.goal_milestone).toBe(false);
      expect(result.value.workout_assigned).toBe(true);
      expect(storage.getCachedNotificationPreferences()?.goal_milestone).toBe(
        false,
      );
    });
  });
});
