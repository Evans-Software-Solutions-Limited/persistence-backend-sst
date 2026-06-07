import { updateNotificationPreferencesCommand } from "@/application/notifications/commands/update-preferences.command";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";

describe("updateNotificationPreferencesCommand", () => {
  it("optimistically merges the partial into the cache and enqueues a POST", () => {
    const storage = new InMemoryStorageAdapter();
    storage.cacheNotificationPreferences({
      workout_assigned: true,
      goal_milestone: true,
    });

    updateNotificationPreferencesCommand(storage, { goal_milestone: false });

    expect(storage.getCachedNotificationPreferences()).toEqual({
      workout_assigned: true,
      goal_milestone: false,
    });

    const queued = storage.getPendingMutations();
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({
      entityType: "notification-preferences",
      operation: "update",
      endpoint: "/notifications/preferences",
      method: "POST",
    });
    // enqueues the PARTIAL, not the merged whole — backend merges atomically
    expect(JSON.parse(queued[0].payload)).toEqual({ goal_milestone: false });
  });

  it("merges onto an empty cache (first toggle before any fetch)", () => {
    const storage = new InMemoryStorageAdapter();
    updateNotificationPreferencesCommand(storage, { friend_request: false });
    expect(storage.getCachedNotificationPreferences()).toEqual({
      friend_request: false,
    });
  });
});
