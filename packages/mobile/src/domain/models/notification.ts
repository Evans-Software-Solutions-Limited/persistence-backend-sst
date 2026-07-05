/**
 * Notification domain model — the mobile-side shape for the
 * notifications surface (list, bell badge, deep-link dispatch).
 *
 * Spec: specs/09-notifications-social/design.md § Frontend — domain models
 *       specs/09-notifications-social/requirements.md STORY-002, STORY-007
 *
 * ── Taxonomy (producer-owned, per locked decision #10) ──────────────
 * The canonical source of truth is the Postgres `notification_type`
 * enum, mirrored by the backend `NotificationType` at
 * `microservices/core/src/application/repositories/notificationRepository.ts`.
 * Only the 9 values below have live producers today (PR #81). The
 * streak / nutrition / on-behalf types sketched in design.md's inline
 * inventory are registered by THEIR producing specs (06 / 13 / 10) when
 * those features ship — NOT bulk-added here. See the "Revised 2026-06-07"
 * note in design.md.
 *
 * The renderer is forward-compatible: a server ahead of the client can
 * send a `type` this build doesn't know — it still renders (generic
 * fallback visual) and stays markable-read. Never crash, never 400 the
 * list on an unknown type. That's why `Notification.type` is the
 * widened `WireNotificationType`, not the strict union.
 */

/**
 * Known notification types. The first 9 shipped with PR #81; the trailing
 * four are the M8 (10-trainer-features) Coach Mode Phase 3 on-behalf events,
 * registered here now their backend producers ship (cross-cuts § 5, DB enum
 * migration 20260705150000). Streak/nutrition producer types (06/13) remain
 * unregistered and ride the forward-compatible `WireNotificationType` path.
 */
export type NotificationType =
  | "workout_assigned"
  | "friend_request"
  | "pt_request"
  | "pt_accepted"
  | "physio_request"
  | "physio_accepted"
  | "workout_reminder"
  | "goal_milestone"
  | "trainer_feedback"
  // M8 Coach Mode Phase 3 — coach on-behalf / assignment events.
  | "goal_assigned_by_trainer"
  | "workout_logged_on_behalf"
  | "measurement_logged_on_behalf"
  | "nutrition_target_set_by_trainer";

/**
 * The 9 known types as a runtime array. Drives the preferences screen's
 * first-open `DEFAULT_OPT_IN` write + the data-driven category list.
 * Order is the canonical enum order from the backend.
 */
export const NOTIFICATION_TYPES: readonly NotificationType[] = [
  "workout_assigned",
  "friend_request",
  "pt_request",
  "pt_accepted",
  "physio_request",
  "physio_accepted",
  "workout_reminder",
  "goal_milestone",
  "trainer_feedback",
  "goal_assigned_by_trainer",
  "workout_logged_on_behalf",
  "measurement_logged_on_behalf",
  "nutrition_target_set_by_trainer",
] as const;

/**
 * Wire-format notification type. A known `NotificationType`, OR any other
 * string the server might send (a future enum value this build predates).
 * The `(string & {})` keeps editor autocomplete on the known union while
 * still accepting arbitrary strings at runtime — the forward-compatible
 * renderer contract.
 */
export type WireNotificationType = NotificationType | (string & {});

/** Narrow a wire type to a known `NotificationType`. */
export function isKnownNotificationType(
  type: string,
): type is NotificationType {
  return (NOTIFICATION_TYPES as readonly string[]).includes(type);
}

/**
 * Human-readable label per known type. Used by the preferences rows and
 * as a fallback display name. Unknown types fall back to a humanised
 * form of the raw type string (see `notificationTypeLabel`).
 */
export const NOTIFICATION_TYPE_LABELS: Record<NotificationType, string> = {
  workout_assigned: "Workout assigned",
  friend_request: "Friend requests",
  pt_request: "Trainer requests",
  pt_accepted: "Trainer request accepted",
  physio_request: "Physio requests",
  physio_accepted: "Physio request accepted",
  workout_reminder: "Workout reminders",
  goal_milestone: "Goal milestones",
  trainer_feedback: "Trainer feedback",
  goal_assigned_by_trainer: "Goals assigned by coach",
  workout_logged_on_behalf: "Workouts logged by coach",
  measurement_logged_on_behalf: "Measurements logged by coach",
  nutrition_target_set_by_trainer: "Nutrition targets set by coach",
};

/**
 * Display label for any wire type — known label when recognised,
 * otherwise a humanised fallback (`some_new_type` → "Some new type") so
 * a future server value still renders a sensible string.
 */
export function notificationTypeLabel(type: WireNotificationType): string {
  if (isKnownNotificationType(type)) {
    return NOTIFICATION_TYPE_LABELS[type];
  }
  const spaced = type.replace(/_/g, " ").trim();
  if (spaced.length === 0) return "Notification";
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Mobile-side notification. Dates are ISO strings (codebase convention —
 * the SQLite cache stores ISO text and the rest of the domain models use
 * the same; cf. `dashboard.ts`). `readAt === null` means unread.
 *
 * Field mapping from the backend `AppNotification` wire shape (done in
 * the API adapter, NOT the backend):
 *   - `message`  → `body`        (backend column is `message`)
 *   - `data.deepLink` (if present) → `deepLink`
 *   - `isRead` + `readAt`        → `readAt` (null = unread)
 */
export type Notification = {
  id: string;
  /** Widened to tolerate future server enum values. */
  type: WireNotificationType;
  title: string;
  /** Mapped from backend `message`; `""` when the server sent null. */
  body: string;
  /**
   * Resolved deep-link target, or null when the notification carries no
   * explicit `data.deepLink`. 09.6 derives a route from `type` +
   * `relatedEntity*` when this is null, falling back to Home.
   */
  deepLink: string | null;
  /** Opaque type-specific payload (identifiers + deepLink live here). */
  data: Record<string, unknown>;
  relatedEntityType: string | null;
  relatedEntityId: string | null;
  /** ISO timestamp the row was read, or null when unread. */
  readAt: string | null;
  /** ISO timestamp the notification was created. */
  createdAt: string;
};

/** True when the notification has not been read yet. */
export function isUnread(notification: Notification): boolean {
  return notification.readAt === null;
}

/**
 * One page of notifications as returned by `GET /notifications` and
 * mirrored by the offline cache read. `nextCursor` is the opaque keyset
 * token for the next (older) page, or null when exhausted.
 */
export type NotificationsPage = {
  notifications: Notification[];
  nextCursor: string | null;
  /** Server-authoritative total unread (all rows, not just this page). */
  unreadCount: number;
};
