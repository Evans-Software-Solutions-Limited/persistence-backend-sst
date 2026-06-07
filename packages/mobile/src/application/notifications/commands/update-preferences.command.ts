/**
 * Update-preferences command — optimistic local merge + sync-queue
 * enqueue of the partial `POST /notifications/preferences` payload.
 *
 * The optimistic write merges the partial onto the cached map so the UI
 * reflects the toggle immediately. On flush, the sync worker resets the
 * cache to the server's authoritative merged column (see the
 * `notification-preferences` branch in `sync.command.ts`).
 *
 * Spec: specs/09-notifications-social/design.md § Offline behaviour
 *       requirements.md STORY-003 AC 3.5, STORY-006 AC 6.3
 */

import type { NotificationPreferences } from "@/domain/models/notification-preferences";
import type { StoragePort } from "@/domain/ports/storage.port";

/**
 * Optimistically merge a partial opt-in map into the cache, then enqueue
 * the partial for the sync worker. The enqueued payload is the PARTIAL
 * (not the merged whole) — the backend does the atomic JSONB merge, so
 * replaying a partial is safe and preserves any concurrently-changed
 * sibling keys.
 */
export function updateNotificationPreferencesCommand(
  storage: StoragePort,
  partial: NotificationPreferences,
): void {
  const current = storage.getCachedNotificationPreferences() ?? {};
  storage.cacheNotificationPreferences({ ...current, ...partial });
  storage.enqueueMutation({
    entityType: "notification-preferences",
    operation: "update",
    payload: partial,
    endpoint: "/notifications/preferences",
    method: "POST",
  });
}
