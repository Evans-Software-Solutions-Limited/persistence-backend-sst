/**
 * Notification preferences query — cache-first read + background refresh.
 *
 * Spec: specs/09-notifications-social/design.md § Offline behaviour
 *       requirements.md STORY-003, STORY-006 AC 6.3
 */

import type { NotificationPreferences } from "@/domain/models/notification-preferences";
import { normalizePreferences } from "@/domain/models/notification-preferences";
import type { ApiPort } from "@/domain/ports/api.port";
import type { StoragePort } from "@/domain/ports/storage.port";
import { ok, type Result, type ApiError } from "@/shared/errors";

/**
 * Synchronous cache read. Returns null when nothing has been cached yet.
 */
export function getPreferencesQuery(
  storage: StoragePort,
): NotificationPreferences | null {
  return storage.getCachedNotificationPreferences();
}

/**
 * Collect un-flushed optimistic preference toggles from the sync queue,
 * merged latest-wins into a single partial map. Exported so the sync-flush
 * response-capture (sync.command) can re-apply still-pending toggles on top
 * of a server merged column it just received, instead of clobbering them.
 */
export function pendingPreferenceOverrides(
  storage: StoragePort,
): NotificationPreferences {
  let merged: NotificationPreferences = {};
  for (const m of storage.getPendingMutations()) {
    if (m.entityType !== "notification-preferences") continue;
    // `payload` was produced by `enqueueMutation` via `JSON.stringify`, so
    // it always parses; `normalizePreferences` filters to known boolean keys.
    const partial = JSON.parse(m.payload) as Record<string, unknown>;
    merged = { ...merged, ...normalizePreferences(partial) };
  }
  return merged;
}

/**
 * Fetch the per-type opt-in map from the backend and write it through to
 * the cache. The server applies defaults + drops stale keys; the adapter
 * normalises to known types.
 *
 * Inspector Brad #10: re-apply any un-flushed optimistic toggles ON TOP of
 * the server map before caching, so a refresh that races a just-made toggle
 * (e.g. a cold-open GET still in flight when the user flips a switch)
 * doesn't revert it. Server-wins only for keys the user hasn't locally
 * re-touched.
 */
export async function refreshPreferences(
  api: ApiPort,
  storage: StoragePort,
): Promise<Result<NotificationPreferences, ApiError>> {
  const result = await api.getNotificationPreferences();
  if (!result.ok) return result;
  const merged: NotificationPreferences = {
    ...result.value,
    ...pendingPreferenceOverrides(storage),
  };
  storage.cacheNotificationPreferences(merged);
  return ok(merged);
}
