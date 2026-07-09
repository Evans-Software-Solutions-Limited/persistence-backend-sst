import { and, desc, eq, lt, or, sql } from "drizzle-orm";
import { notifications } from "@persistence/db";
import { getDb } from "@persistence/db/client";
import type { DbOrTx } from "./personalRecordsRepository";

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
  | "freeze_token_applied"
  // M8 (10-trainer-features) trainer on-behalf / assignment events. DB enum
  // extended in 20260705150000_coach_notification_type_on_behalf_values.sql
  // (Phase 3 / 10.3). Default opt-in "on" per cross-cuts § 5.
  // (workout_assigned above is reused for the workout-assignment emit.)
  | "goal_assigned_by_trainer"
  | "workout_logged_on_behalf"
  | "measurement_logged_on_behalf"
  | "nutrition_target_set_by_trainer"
  // M17 (Send brief) — coach → client free-text brief. DB enum extended in
  // 20260709120000_coach_brief_notification_type.sql. Default opt-in "on"
  // per cross-cuts § 5.
  | "coach_brief";

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
  "goal_assigned_by_trainer",
  "workout_logged_on_behalf",
  "measurement_logged_on_behalf",
  "nutrition_target_set_by_trainer",
  "coach_brief",
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
  cursor?: string;
  unreadOnly: boolean;
}

/**
 * Result of a keyset list page. `rows` holds up to `limit`
 * notifications; `nextCursor` is an opaque token for fetching the next
 * (older) page, or `null` when the caller has reached the end.
 *
 * Spec: specs/09-notifications-social/design.md § Backend endpoints
 *       > GET /notifications.
 */
export interface ListPage {
  rows: AppNotification[];
  nextCursor: string | null;
}

/**
 * Decoded keyset cursor — the `(createdAt, id)` of the last row of the
 * previous page. The endpoint pages newest-first, so the next page is
 * everything strictly "older" than this position.
 */
interface DecodedCursor {
  createdAt: string;
  id: string;
}

/**
 * Thrown when a `cursor` query param cannot be decoded back into a
 * `(createdAt, id)` pair. The handler maps this to a 400 so a corrupt
 * token fails fast instead of silently restarting pagination (which
 * would loop the client forever).
 */
export class InvalidCursorError extends Error {
  constructor() {
    super("Invalid cursor");
    this.name = "InvalidCursorError";
  }
}

/**
 * Encode a `(createdAt, id)` position as an opaque base64url token:
 * base64url(JSON({ c: createdAt, i: id })). Opaque on purpose — the
 * client treats it as a blob and only echoes it back, so we can change
 * the keyset shape later without a contract break.
 */
export function encodeCursor(position: DecodedCursor): string {
  const json = JSON.stringify({ c: position.createdAt, i: position.id });
  return Buffer.from(json, "utf8").toString("base64url");
}

/**
 * Decode an opaque cursor token back into `(createdAt, id)`. Throws
 * `InvalidCursorError` on any malformed input — bad base64, non-JSON,
 * missing/empty fields, or a non-parseable timestamp.
 */
export function decodeCursor(token: string): DecodedCursor {
  let parsed: unknown;
  try {
    const json = Buffer.from(token, "base64url").toString("utf8");
    parsed = JSON.parse(json);
  } catch {
    throw new InvalidCursorError();
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new InvalidCursorError();
  }

  const { c, i } = parsed as { c?: unknown; i?: unknown };
  if (typeof c !== "string" || typeof i !== "string" || c === "" || i === "") {
    throw new InvalidCursorError();
  }
  if (Number.isNaN(new Date(c).getTime())) {
    throw new InvalidCursorError();
  }

  return { createdAt: c, id: i };
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
    // Optional transaction handle — the coach Send-brief write threads its
    // `db.transaction` handle through here so the notification insert (the
    // deliverable) and the `trainer_actions_audit` insert land in ONE
    // transaction (cross-cuts § 1.4.2). Same optional-`tx` pattern as
    // `GoalRepository.create` / `MeasurementRepository.create`.
    tx?: DbOrTx,
  ): Promise<AppNotification> {
    const db = tx ?? getDb();
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
   * List the user's notifications, newest-first. Keyset (cursor)
   * pagination ordered `created_at DESC, id DESC`. `cursor` encodes the
   * `(createdAt, id)` of the last row of the previous page; the next
   * page is everything strictly older. `unreadOnly=true` ANDs
   * `is_read = false` into the WHERE clause.
   *
   * Fetches `limit + 1` rows: if a surplus row comes back there's
   * another page, so we drop it and emit `nextCursor` from the last
   * kept row; otherwise `nextCursor` is `null`.
   *
   * Ownership: `userId` is the JWT subject — handler MUST NOT take it
   * from the request body.
   *
   * Throws `InvalidCursorError` if `cursor` is malformed.
   */
  async list(userId: string, filters: ListFilters): Promise<ListPage> {
    const db = getDb();
    const { limit, cursor, unreadOnly } = filters;

    const conditions = [eq(notifications.userId, userId)];
    if (unreadOnly) {
      conditions.push(eq(notifications.isRead, false));
    }
    if (cursor !== undefined) {
      const { createdAt, id } = decodeCursor(cursor);
      // Keyset predicate, stable across non-unique created_at, and
      // microsecond-precise: the cursor's `createdAt` is the full
      // `timestamptz::text` of the last row of the previous page, so we
      // cast it back to `timestamptz` for an exact comparison.
      // Comparing against a JS `Date` (millisecond precision) would skip
      // sibling rows whose created_at falls in the truncated sub-ms gap.
      //   created_at < c OR (created_at = c AND id < i)
      const keyset = or(
        sql`${notifications.createdAt} < ${createdAt}::timestamptz`,
        and(
          sql`${notifications.createdAt} = ${createdAt}::timestamptz`,
          lt(notifications.id, id),
        ),
      );
      // `or(...)` is only undefined with zero args; guard for the type.
      if (keyset) conditions.push(keyset);
    }

    const rows = await db
      .select({
        id: notifications.id,
        userId: notifications.userId,
        type: notifications.type,
        title: notifications.title,
        message: notifications.message,
        data: notifications.data,
        isRead: notifications.isRead,
        readAt: notifications.readAt,
        relatedEntityType: notifications.relatedEntityType,
        relatedEntityId: notifications.relatedEntityId,
        createdAt: notifications.createdAt,
        // Full-precision (microsecond) cursor key. `timestamptz::text`
        // round-trips losslessly through `::timestamptz`, unlike a JS
        // Date which truncates to milliseconds. Used ONLY for the
        // opaque cursor — the wire `createdAt` stays a millisecond ISO.
        createdAtCursor: sql<string>`${notifications.createdAt}::text`,
      })
      .from(notifications)
      .where(and(...conditions))
      .orderBy(desc(notifications.createdAt), desc(notifications.id))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;

    const mapped = pageRows.map((row) =>
      toAppNotification({
        ...row,
        type: row.type as NotificationType,
      }),
    );

    const lastRow = pageRows[pageRows.length - 1];
    const nextCursor =
      hasMore && lastRow !== undefined
        ? encodeCursor({ createdAt: lastRow.createdAtCursor, id: lastRow.id })
        : null;

    return { rows: mapped, nextCursor };
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
