/**
 * Mark-read command — optimistic local update + sync-queue enqueue.
 *
 * The cache mark uses COALESCE semantics (only stamps `read_at` when
 * currently null), and the backend's `PATCH /notifications/:id` likewise
 * uses `COALESCE(read_at, NOW())`, so an offline mark then a later sync
 * replay both preserve the ORIGINAL read moment (locked decision #3).
 *
 * Spec: specs/09-notifications-social/design.md § Offline behaviour
 *       requirements.md STORY-005 AC 5.2, STORY-006 AC 6.4
 */

import type { StoragePort } from "@/domain/ports/storage.port";

export type Clock = () => string;

const defaultClock: Clock = () => new Date().toISOString();

/**
 * Optimistically mark a single notification read, then enqueue the
 * `PATCH /notifications/:id` mutation for the sync worker to flush.
 */
export function markNotificationReadCommand(
  storage: StoragePort,
  id: string,
  now: Clock = defaultClock,
): void {
  storage.markCachedNotificationRead(id, now());
  storage.enqueueMutation({
    entityType: "notification",
    entityId: id,
    operation: "update",
    payload: { isRead: true },
    endpoint: `/notifications/${id}`,
    method: "PATCH",
  });
}
