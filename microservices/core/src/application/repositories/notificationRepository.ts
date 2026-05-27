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
  | "trainer_feedback";

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

export class NotificationRepository {
  static readonly key = "NotificationRepository";

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
   * (the WHERE still matches; UPDATE sets the same values). The sync
   * queue replay path depends on this.
   */
  async markRead(
    userId: string,
    notificationId: string,
  ): Promise<AppNotification | null> {
    const db = getDb();

    const result = await db
      .update(notifications)
      .set({ isRead: true, readAt: new Date() })
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
