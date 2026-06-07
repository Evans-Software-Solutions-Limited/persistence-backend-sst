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
  });
});
