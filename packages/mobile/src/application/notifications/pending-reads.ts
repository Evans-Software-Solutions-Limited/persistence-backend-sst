/**
 * Shared "un-flushed optimistic read" reconciliation for notifications.
 *
 * A mark-read / mark-all sits in the sync queue until the worker flushes it;
 * the server is blind to it meanwhile. Both the list (visible rows + header
 * count) and the OS badge must reflect those optimistic reads so a server
 * fetch doesn't bounce them back. Centralised here so the list container and
 * `useNotificationBadge` share ONE implementation — including the timezone-
 * safe timestamp parse (Inspector Brad #83).
 *
 * Spec: specs/09-notifications-social/requirements.md STORY-002, STORY-006
 */

import type { Notification } from "@/domain/models/notification";
import type { StoragePort } from "@/domain/ports/storage.port";

/**
 * Parse a timestamp to a UTC epoch, tolerant of the two formats in play:
 *  - server `created_at`: ISO 8601 (`2026-06-09T12:34:56.000Z`).
 *  - sync-queue `created_at`: the SQLite default `datetime('now')` →
 *    `2026-06-09 12:34:56` (UTC text, NO `T`/`Z`). `Date.parse` reads that
 *    bare form as LOCAL time, so a mark-all moment would be off by the
 *    device's UTC offset (Inspector Brad #83). Coerce it to explicit UTC
 *    before parsing.
 */
function parseUtc(ts: string): number {
  const normalised = /[TZ]/.test(ts) ? ts : `${ts.replace(" ", "T")}Z`;
  return Date.parse(normalised);
}

/**
 * Un-flushed optimistic reads from the sync queue:
 * - `ids`: individually mark-read notification ids.
 * - `markAllAt`: the timestamp of the latest un-flushed `mark-all`, or null.
 *   A mark-all only covers notifications that existed at that moment — rows
 *   created AFTER it (new arrivals during the pending window) must stay
 *   unread, so the flag is time-scoped (Inspector Brad #8).
 */
export function pendingReadState(storage: StoragePort): {
  markAllAt: string | null;
  ids: Set<string>;
} {
  const pending = storage
    .getPendingMutations()
    .filter((m) => m.entityType === "notification");
  let markAllAt: string | null = null;
  const ids = new Set<string>();
  for (const m of pending) {
    if (m.endpoint === "/notifications/all") {
      if (markAllAt === null || m.createdAt > markAllAt)
        markAllAt = m.createdAt;
    } else if (m.entityId) {
      ids.add(m.entityId);
    }
  }
  return { markAllAt, ids };
}

/**
 * True when a notification is covered by an un-flushed optimistic read:
 * individually marked, OR predating a pending mark-all (UTC-correct compare).
 */
export function isPendingRead(
  n: Notification,
  markAllAt: string | null,
  ids: Set<string>,
): boolean {
  if (ids.has(n.id)) return true;
  if (markAllAt !== null) {
    const at = parseUtc(markAllAt);
    const created = parseUtc(n.createdAt);
    if (!Number.isNaN(at) && !Number.isNaN(created) && created <= at) {
      return true;
    }
  }
  return false;
}

/**
 * Re-apply un-flushed optimistic reads onto a freshly-fetched page so the
 * server's (older) read state doesn't clobber them — while leaving
 * post-mark-all arrivals unread.
 */
export function applyPendingReads(
  items: Notification[],
  storage: StoragePort,
  now: string,
): Notification[] {
  const { markAllAt, ids } = pendingReadState(storage);
  return items.map((n) =>
    n.readAt === null && isPendingRead(n, markAllAt, ids)
      ? { ...n, readAt: now }
      : n,
  );
}

/**
 * Optimistic unread count for a freshly-fetched (and pending-read-applied)
 * page 1 — used by the list header.
 * - With a pending mark-all, everything up to that moment is read, so the
 *   only remaining unread are post-mark-all arrivals (the newest rows, all
 *   on page 1): count the page's still-unread rows.
 * - Otherwise it's the server total minus every individually-pending read.
 */
export function optimisticUnread(
  serverUnread: number,
  pageAfterReads: Notification[],
  storage: StoragePort,
): number {
  const { markAllAt, ids } = pendingReadState(storage);
  if (markAllAt !== null) {
    return pageAfterReads.filter((n) => n.readAt === null).length;
  }
  return Math.max(0, serverUnread - ids.size);
}

/**
 * Optimistic unread count for the OS badge, which only has a server total
 * (no fetched page). Mirrors `optimisticUnread` but for the no-page caller:
 * - With a pending mark-all, the SQLite cache already reflects it
 *   (`markAllCachedNotificationsRead` + COALESCE-preserving write-through),
 *   so its unread count IS the post-mark-all remainder — use it.
 * - Otherwise subtract individually-pending reads from the server total.
 *
 * This stops the badge from re-painting the stale pre-mark-all server count
 * and clobbering an acknowledged "mark all read" (Inspector Brad badge race).
 */
export function optimisticBadgeCount(
  serverUnread: number,
  storage: StoragePort,
): number {
  const { markAllAt, ids } = pendingReadState(storage);
  if (markAllAt !== null) {
    return storage.getCachedUnreadCount();
  }
  return Math.max(0, serverUnread - ids.size);
}
