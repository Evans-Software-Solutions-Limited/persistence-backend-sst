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

  // Coalesce rapid toggles: if a preferences POST is already queued (and
  // not yet in-flight), merge this partial into it rather than enqueuing a
  // second round-trip. Mirrors the offline edit-coalescing used for
  // exercises — `updateMutationPayload` only touches pending/failed entries.
  const queued = storage
    .getPendingMutations()
    .find(
      (m) =>
        m.entityType === "notification-preferences" &&
        m.endpoint === "/notifications/preferences",
    );
  if (queued) {
    let existing: NotificationPreferences = {};
    try {
      existing = JSON.parse(queued.payload) as NotificationPreferences;
    } catch {
      existing = {};
    }
    storage.updateMutationPayload(queued.id, { ...existing, ...partial });
    return;
  }

  storage.enqueueMutation({
    entityType: "notification-preferences",
    operation: "update",
    payload: partial,
    endpoint: "/notifications/preferences",
    method: "POST",
  });
}
