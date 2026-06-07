/**
 * Notification preferences query — cache-first read + background refresh.
 *
 * Spec: specs/09-notifications-social/design.md § Offline behaviour
 *       requirements.md STORY-003, STORY-006 AC 6.3
 */

import type { NotificationPreferences } from "@/domain/models/notification-preferences";
import type { ApiPort } from "@/domain/ports/api.port";
import type { StoragePort } from "@/domain/ports/storage.port";
import { ok, type Result, type ApiError } from "@/shared/errors";

/**
 * Synchronous cache read. Returns null when nothing has been cached yet
 * (first-ever open) — the Preferences container treats that as the
 * trigger to write `DEFAULT_OPT_IN`.
 */
export function getPreferencesQuery(
  storage: StoragePort,
): NotificationPreferences | null {
  return storage.getCachedNotificationPreferences();
}

/**
 * Fetch the per-type opt-in map from the backend and write it through to
 * the cache. The server applies defaults + drops stale keys; the adapter
 * normalises to known types.
 */
export async function refreshPreferences(
  api: ApiPort,
  storage: StoragePort,
): Promise<Result<NotificationPreferences, ApiError>> {
  const result = await api.getNotificationPreferences();
  if (!result.ok) return result;
  storage.cacheNotificationPreferences(result.value);
  return ok(result.value);
}
