/**
 * 09.7 — offline + cache verification (integration).
 *
 * Exercises the full offline-first loop across the command + cache + sync
 * drain layers (real `processSyncQueue` against a mocked fetch), proving:
 *   - cached list renders with no network (STORY-006 AC 6.1),
 *   - mark-read is optimistic + queued, replays are idempotent, and the
 *     offline-tap moment is preserved client-side (AC 6.4 / locked #3),
 *   - preferences toggle is optimistic + queued, and the cache is reset to
 *     the server's merged column on flush (AC 6.3, 3.6).
 *
 * Contract note (Revised 2026-06-07): `PATCH /notifications/:id` accepts
 * only `{ isRead: true }` and stamps `read_at = COALESCE(read_at, NOW())`
 * server-side, so the SERVER records the first-flush moment (not the
 * offline-tap moment) and COALESCE makes replays idempotent. The
 * offline-tap moment lives in the LOCAL cache (also COALESCE).
 */

import { processSyncQueue } from "@/application/commands/sync.command";
import { getNotificationsQuery } from "@/application/notifications/queries/list-notifications.query";
import { markNotificationReadCommand } from "@/application/notifications/commands/mark-read.command";
import { updateNotificationPreferencesCommand } from "@/application/notifications/commands/update-preferences.command";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import { InMemoryAuthAdapter } from "@/adapters/auth/__tests__/in-memory-auth.adapter";
import { makeNotification } from "@/application/notifications/__tests__/notification.fixture";

const mockFetch = jest.fn();
(globalThis as Record<string, unknown>).fetch = mockFetch;

const API = "https://api.test";

describe("notifications offline integration (09.7)", () => {
  let storage: InMemoryStorageAdapter;
  let auth: InMemoryAuthAdapter;

  beforeEach(() => {
    storage = new InMemoryStorageAdapter();
    storage.initialize();
    auth = new InMemoryAuthAdapter();
    mockFetch.mockReset();
  });

  it("09.7.1 renders the cached list with no network", () => {
    storage.cacheNotifications([
      makeNotification({ id: "a", createdAt: "2026-06-07T09:00:00.000Z" }),
      makeNotification({ id: "b", createdAt: "2026-06-06T09:00:00.000Z" }),
    ]);
    // No fetch issued — a pure cache read backs the offline cold-start.
    const { notifications, unreadCount } = getNotificationsQuery(storage);
    expect(notifications.map((n) => n.id)).toEqual(["a", "b"]);
    expect(unreadCount).toBe(2);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("09.7.2 mark-read offline → queue → reconnect; replay-idempotent, local moment preserved", async () => {
    const offlineMoment = "2026-06-07T10:00:00.000Z";
    storage.cacheNotifications([makeNotification({ id: "n1", readAt: null })]);

    // Offline tap: optimistic local mark (COALESCE) + enqueue {isRead:true}.
    markNotificationReadCommand(storage, "n1", () => offlineMoment);
    expect(storage.getCachedNotifications()[0].readAt).toBe(offlineMoment);
    const queued = storage.getPendingMutations();
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({
      endpoint: "/notifications/n1",
      method: "PATCH",
    });
    // No client timestamp on the wire — the server owns read_at via COALESCE.
    expect(JSON.parse(queued[0].payload)).toEqual({ isRead: true });

    // Reconnect: flush. Server returns the row (read_at stamped server-side).
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: { id: "n1", isRead: true, readAt: "2026-06-07T10:02:00.000Z" },
      }),
    });
    const result = await processSyncQueue(storage, auth, API);
    expect(result.succeeded).toBe(1);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Replay-idempotency: a second drain finds the entry completed and does
    // NOT re-send (so the server's COALESCE'd moment can't be advanced).
    await processSyncQueue(storage, auth, API);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // The offline-tap moment is preserved in the local cache.
    expect(storage.getCachedNotifications()[0].readAt).toBe(offlineMoment);
  });

  it("09.7.3 preferences toggle offline → queue → reconnect → cache reset to merged column", async () => {
    storage.cacheNotificationPreferences({
      goal_milestone: true,
      workout_assigned: true,
    });

    // Offline toggle: optimistic merge + enqueue the PARTIAL.
    updateNotificationPreferencesCommand(storage, { goal_milestone: false });
    expect(storage.getCachedNotificationPreferences()).toEqual({
      goal_milestone: false,
      workout_assigned: true,
    });
    const queued = storage.getPendingMutations();
    expect(JSON.parse(queued[0].payload)).toEqual({ goal_milestone: false });

    // Reconnect: server merges atomically + echoes the FULL merged column.
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          goal_milestone: false,
          workout_assigned: true,
          friend_request: true,
        },
      }),
    });
    const result = await processSyncQueue(storage, auth, API);
    expect(result.succeeded).toBe(1);

    // Local cache reset to the server's authoritative merged column.
    expect(storage.getCachedNotificationPreferences()).toEqual({
      goal_milestone: false,
      workout_assigned: true,
      friend_request: true,
    });
  });
});
