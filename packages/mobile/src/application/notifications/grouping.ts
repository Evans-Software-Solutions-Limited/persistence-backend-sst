/**
 * View-model helpers for the notifications list: date-section grouping +
 * compact relative-time formatting. Pure functions (clock injected) so the
 * presenter stays dumb and the logic is unit-testable.
 *
 * Spec: specs/09-notifications-social/requirements.md STORY-002 AC 2.3
 *       design.md § NotificationsListPresenter (Today / Yesterday / This
 *       Week / Older sections)
 */

import type { Notification } from "@/domain/models/notification";

export type NotificationGroupLabel =
  | "Today"
  | "Yesterday"
  | "This Week"
  | "Older";

export type NotificationGroup = {
  label: NotificationGroupLabel;
  notifications: Notification[];
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Local-midnight timestamp for the day containing `now`. */
function startOfDay(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Bucket notifications into Today / Yesterday / This Week / Older, in that
 * fixed order, dropping empty groups. Input order is preserved within each
 * group (the cache returns newest-first), and rows with an unparseable
 * `createdAt` fall into "Older" rather than being dropped.
 */
export function groupNotificationsByDate(
  notifications: Notification[],
  now: number = Date.now(),
): NotificationGroup[] {
  const todayStart = startOfDay(now);
  const yesterdayStart = todayStart - DAY_MS;
  const weekStart = todayStart - 6 * DAY_MS;

  const buckets: Record<NotificationGroupLabel, Notification[]> = {
    Today: [],
    Yesterday: [],
    "This Week": [],
    Older: [],
  };

  for (const n of notifications) {
    const created = Date.parse(n.createdAt);
    if (Number.isNaN(created)) {
      buckets.Older.push(n);
    } else if (created >= todayStart) {
      buckets.Today.push(n);
    } else if (created >= yesterdayStart) {
      buckets.Yesterday.push(n);
    } else if (created >= weekStart) {
      buckets["This Week"].push(n);
    } else {
      buckets.Older.push(n);
    }
  }

  const order: NotificationGroupLabel[] = [
    "Today",
    "Yesterday",
    "This Week",
    "Older",
  ];
  return order
    .map((label) => ({ label, notifications: buckets[label] }))
    .filter((group) => group.notifications.length > 0);
}

/**
 * Compact relative-time label for a notification row (e.g. "now", "5m",
 * "3h", "2d", "4w"). Beyond ~4 weeks falls back to a short locale date.
 * Future timestamps (clock skew) clamp to "now".
 */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const diffMs = Math.max(0, now - then);
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.floor(days / 7);
  if (weeks <= 4) return `${weeks}w`;
  return new Date(then).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
