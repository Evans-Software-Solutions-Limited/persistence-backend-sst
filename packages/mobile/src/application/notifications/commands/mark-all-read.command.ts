/**
 * Mark-all-read command — optimistic local update + sync-queue enqueue.
 *
 * Spec: specs/09-notifications-social/design.md § Offline behaviour
 *       requirements.md STORY-002 AC 2.2
 */

import type { StoragePort } from "@/domain/ports/storage.port";
import type { Clock } from "./mark-read.command";

const defaultClock: Clock = () => new Date().toISOString();

/**
 * Optimistically mark every cached unread notification read, then enqueue
 * the `PATCH /notifications/all` mutation. Backend is idempotent — a
 * replay flips no extra rows.
 */
export function markAllNotificationsReadCommand(
  storage: StoragePort,
  now: Clock = defaultClock,
): void {
  storage.markAllCachedNotificationsRead(now());
  storage.enqueueMutation({
    entityType: "notification",
    operation: "update",
    payload: {},
    endpoint: "/notifications/all",
    method: "PATCH",
  });
}
