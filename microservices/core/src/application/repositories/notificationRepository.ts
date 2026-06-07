import { and, desc, eq, sql } from "drizzle-orm";
import { notifications } from "@persistence/db";
import { getDb } from "@persistence/db/client";

/**
 * Notification type union — mirrors the `notification_type` Postgres
 * enum at `packages/db/src/schema.ts:139-149`. The DB enum is
 * authoritative; this list MUST stay in sync. Adding a value requires
 * (1) a Drizzle/SQL migration extending the enum, (2) updating this
 * union, (3) updating the default-preferences map in
 * `profileRepository.ts`, and (4) mirroring in mobile's
 * NotificationType.
 *
 * Spec: specs/09-notifications-social/design.md § Domain models.
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
  // M4 (06-progress-goals) streak events. DB enum extended in
  // 20260607120000_m4_notification_type_streak_values.sql. Default opt-in
  // "on" per cross-cuts § 5 (the JSONB prefs default '{}' reads as all-on).
  | "streak_milestone"
  | "streak_at_risk"
  | "freeze_token_applied";

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
  "streak_milestone",
  "streak_at_risk",
  "freeze_token_applied",
] as const;

/**
 * Wire shape returned by the list endpoint. Pure projection of the
 * underlying Drizzle `notifications.$inferSelect`, with date/JSONB
 * fields normalised to ISO strings / plain objects.
 *
 * Spec: specs/09-notifications-social/design.md § Backend endpoints.
 */
export interface AppNotification {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  message: string | null;
  data: Record<string, unknown>;
  isRead: boolean;
  readAt: string | null;
  relatedEntityType: string | null;
  relatedEntityId: string | null;
  createdAt: string;
}

export interface ListFilters {
  limit: number;
  offset: number;
  unreadOnly: boolean;
}

function toIsoString(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function toRequiredIsoString(value: Date | string | null | undefined): string {
  const iso = toIsoString(value);
  return iso ?? new Date(0).toISOString();
}

/**
 * Map a raw notifications row to the wire-format `AppNotification`.
 * Centralised so the list / mark-read / mark-all paths all emit the
 * same shape — mobile parses one envelope.
 */
function toAppNotification(row: {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  message: string | null;
  data: Record<string, unknown> | null;
  isRead: boolean | null;
  readAt: Date | string | null;
  relatedEntityType: string | null;
  relatedEntityId: string | null;
  createdAt: Date | string | null;
}): AppNotification {
  return {
    id: row.id,
    userId: row.userId,
    type: row.type,
    title: row.title,
    message: row.message ?? null,
    data: (row.data ?? {}) as Record<string, unknown>,
    isRead: row.isRead === true,
    readAt: toIsoString(row.readAt),
    relatedEntityType: row.relatedEntityType ?? null,
    relatedEntityId: row.relatedEntityId ?? null,
    createdAt: toRequiredIsoString(row.createdAt),
  };
}

export interface CreateNotificationInput {
  type: NotificationType;
  title: string;
  message?: string | null;
  data?: Record<string, unknown>;
  relatedEntityType?: string | null;
  relatedEntityId?: string | null;
}

export class NotificationRepository {
  static readonly key = "NotificationRepository";

  /**
   * Insert one notification for `userId`. This is the single write path other
   * subsystems (the streak engine, PR detection) call to emit a notification
   * — added in M4 (06-progress-goals) because M7 shipped only the read/update
   * surface. M7 (09-notifications-social) owns delivery + rendering and will
   * converge on this writer.
   *
   * Ownership: `userId` is supplied by the trusted emitter (the JWT subject of
   * the event that triggered it), never from a request body.
   */
  async create(
    userId: string,
    input: CreateNotificationInput,
  ): Promise<AppNotification> {
    const db = getDb();
    const rows = await db
      .insert(notifications)
      .values({
        userId,
        type: input.type,
        title: input.title,
        message: input.message ?? null,
        data: input.data ?? {},
        relatedEntityType: input.relatedEntityType ?? null,
        relatedEntityId: input.relatedEntityId ?? null,
      })
      .returning();

    const row = rows[0];
    return toAppNotification({
      ...row,
      type: row.type as NotificationType,
    });
  }

  /**
   * List the user's notifications, newest-first. Pagination via
   * `limit` + `offset`. `unreadOnly=true` ANDs `is_read = false` into
   * the WHERE clause.
   *
   * Ownership: `userId` is the JWT subject — handler MUST NOT take it
   * from the request body.
   */
  async list(userId: string, filters: ListFilters): Promise<AppNotification[]> {
    const db = getDb();
    const { limit, offset, unreadOnly } = filters;

    const whereClause = unreadOnly
      ? and(eq(notifications.userId, userId), eq(notifications.isRead, false))
      : eq(notifications.userId, userId);

    const rows = await db
      .select()
      .from(notifications)
      .where(whereClause)
      .orderBy(desc(notifications.createdAt))
      .limit(limit)
      .offset(offset);

    return rows.map((row) =>
      toAppNotification({
        ...row,
        type: row.type as NotificationType,
      }),
    );
  }

  /**
   * Total unread count for the user — drives the bell-icon badge.
   * Returned alongside the list response so the mobile client gets
   * the badge in the same round-trip.
   */
  async countUnread(userId: string): Promise<number> {
    const db = getDb();
    const result = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(notifications)
      .where(
        and(eq(notifications.userId, userId), eq(notifications.isRead, false)),
      );
    return result[0]?.total ?? 0;
  }

  /**
   * Mark a single notification as read. Ownership is folded into the
   * UPDATE's WHERE clause (M2 learning #14): no TOCTOU, one round-trip,
   * wrong-user and missing-row collapse to the same "no rows updated"
   * outcome. Returns the updated row, or `null` if zero rows matched
   * — the handler maps that to 404 without leaking existence.
   *
   * Idempotent: re-marking an already-read row returns the row again
   * (the WHERE still matches; UPDATE sets the same values).
   *
   * Inspector Brad PR #81 sweep 2: the WHERE intentionally lacks an
   * `is_read = false` filter so the sync-queue replay path stays
   * idempotent — re-marking an already-read row must still resolve.
   * BUT a naive `readAt: new Date()` overwrites the original
   * read-moment on every replay, advancing the timestamp by however
   * long the offline queue sat. Use `COALESCE(read_at, NOW())` so the
   * first read wins and subsequent replays preserve the original
   * timestamp — matching `markAllRead`, which filters unread at the
   * row level.
   */
  async markRead(
    userId: string,
    notificationId: string,
  ): Promise<AppNotification | null> {
    const db = getDb();

    const result = await db
      .update(notifications)
      .set({
        isRead: true,
        readAt: sql`COALESCE(${notifications.readAt}, NOW())`,
      })
      .where(
        and(
          eq(notifications.id, notificationId),
          eq(notifications.userId, userId),
        ),
      )
      .returning();

    const row = result[0];
    if (!row) return null;

    return toAppNotification({
      ...row,
      type: row.type as NotificationType,
    });
  }

  /**
   * Mark every unread notification for the user as read in one UPDATE.
   * Returns the number of rows newly flipped. Already-read rows are
   * not touched (the WHERE filters them out), so a second call returns
   * 0 — idempotent.
   *
   * Ownership: `user_id = userId` is the only WHERE clause besides the
   * unread filter; cross-user mark-all is impossible.
   */
  async markAllRead(userId: string): Promise<number> {
    const db = getDb();

    const result = await db
      .update(notifications)
      .set({ isRead: true, readAt: new Date() })
      .where(
        and(eq(notifications.userId, userId), eq(notifications.isRead, false)),
      )
      .returning({ id: notifications.id });

    return result.length;
  }
}
