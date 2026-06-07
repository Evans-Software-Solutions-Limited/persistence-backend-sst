/**
 * Unread-count query — powers the Home bell badge (09.5) and the list
 * header's "{N} UNREAD" eyebrow.
 *
 * The synchronous read derives the count from the SQLite cache (offline-
 * safe). The async refresh asks the backend for the authoritative total
 * via a minimal 1-row list fetch — the server's `unreadCount` covers ALL
 * unread rows, not just the cached 100.
 *
 * Spec: specs/09-notifications-social/requirements.md STORY-001 AC 1.4
 *       design.md § Risks (unread count drifts → server-wins on refresh)
 */

import type { ApiPort } from "@/domain/ports/api.port";
import type { StoragePort } from "@/domain/ports/storage.port";
import { ok, type Result, type ApiError } from "@/shared/errors";

/** Synchronous cache-derived unread count. */
export function getUnreadCountQuery(storage: StoragePort): number {
  return storage.getCachedUnreadCount();
}

/**
 * Fetch the server-authoritative unread count. Uses `limit: 1` to keep
 * the round-trip cheap — we only read `unreadCount` off the envelope and
 * deliberately do NOT write the single row through to the cache (a write
 * is harmless but pointless for a count-only refresh).
 */
export async function refreshUnreadCount(
  api: ApiPort,
  _storage: StoragePort,
): Promise<Result<number, ApiError>> {
  const result = await api.getNotifications({ limit: 1 });
  if (!result.ok) return result;
  return ok(result.value.unreadCount);
}
