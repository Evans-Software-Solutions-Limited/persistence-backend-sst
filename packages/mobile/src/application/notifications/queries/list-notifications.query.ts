/**
 * Notifications list query — cache-first read with background refresh.
 *
 * Mirrors `dashboard.query.ts`: one synchronous read
 * (`getNotificationsQuery`) for the immediate offline-first list render,
 * one async refresh helper (`refreshNotifications`) that fetches a page
 * from the backend and writes the rows through to the SQLite LRU cache.
 *
 * Spec: specs/09-notifications-social/design.md § Offline behaviour
 *       requirements.md STORY-002, STORY-006 AC 6.1, 6.2
 */

import type {
  Notification,
  NotificationsPage,
} from "@/domain/models/notification";
import type { ApiPort, GetNotificationsParams } from "@/domain/ports/api.port";
import type { StoragePort } from "@/domain/ports/storage.port";
import { ok, type Result, type ApiError } from "@/shared/errors";

export type NotificationsListQueryResult = {
  /** Cached notifications, newest-first (capped at the LRU bound). */
  notifications: Notification[];
  /** Cache-derived unread count (offline fallback for the bell badge). */
  unreadCount: number;
};

/**
 * Synchronous cache read. Never touches the network — callers render
 * this immediately, then trigger `refreshNotifications` from an effect /
 * pull-to-refresh.
 */
export function getNotificationsQuery(
  storage: StoragePort,
  limit = 100,
): NotificationsListQueryResult {
  return {
    notifications: storage.getCachedNotifications(limit),
    unreadCount: storage.getCachedUnreadCount(),
  };
}

/**
 * Fetch a page from the backend and write the rows through to the cache.
 * Returns the full page (rows + nextCursor + server-authoritative
 * unreadCount). On failure the cache is left untouched so the last-known
 * rows stay browsable offline.
 *
 * Pass `params.cursor` (from a prior page's `nextCursor`) to page older;
 * omit it to refresh the newest page.
 */
export async function refreshNotifications(
  api: ApiPort,
  storage: StoragePort,
  params?: GetNotificationsParams,
): Promise<Result<NotificationsPage, ApiError>> {
  const result = await api.getNotifications(params);
  if (!result.ok) return result;
  storage.cacheNotifications(result.value.notifications);
  return ok(result.value);
}
