import {
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { profiles, ptClientRelationships, workouts } from "./schema";

// ─── Coach calendar: sessions and bookings (PER-123, design I, migration 10) ─
// Migration: 20261125123634_coach_sessions_calendar.sql. A weekly repeat is up
// to 26 rows sharing series_id. Assigned workouts stay dateless; only these
// bookings have times.

export const COACH_SESSION_KINDS = [
  "in_person",
  "video",
  "check_in_call",
  "own_training",
] as const;
export type CoachSessionKind = (typeof COACH_SESSION_KINDS)[number];

export const COACH_SESSION_ATTENDEE_STATUSES = [
  "invited",
  "accepted",
  "declined",
  "cancelled",
] as const;
export type CoachSessionAttendeeStatus =
  (typeof COACH_SESSION_ATTENDEE_STATUSES)[number];

export const coachSessions = pgTable(
  "coach_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    trainerId: uuid("trainer_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    kind: text("kind").$type<CoachSessionKind>().notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    durationMin: integer("duration_min").notNull(),
    location: text("location"),
    videoUrl: text("video_url"),
    workoutId: uuid("workout_id").references(() => workouts.id, {
      onDelete: "set null",
    }),
    seriesId: uuid("series_id"),
    notes: text("notes"),
    reminderMinutes: integer("reminder_minutes"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    revision: integer("revision").notNull().default(1),
    clientRequestId: text("client_request_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("coach_sessions_client_request_uq").on(
      t.trainerId,
      t.clientRequestId,
    ),
    index("coach_sessions_trainer_starts_idx").on(t.trainerId, t.startsAt),
    index("coach_sessions_series_idx")
      .on(t.seriesId, t.startsAt)
      .where(sql`${t.seriesId} IS NOT NULL`),
    index("coach_sessions_reminder_due_idx")
      .on(t.startsAt)
      .where(
        sql`${t.reminderMinutes} IS NOT NULL AND ${t.cancelledAt} IS NULL`,
      ),
    check(
      "coach_sessions_kind_check",
      sql`${t.kind} IN ('in_person', 'video', 'check_in_call', 'own_training')`,
    ),
    check(
      "coach_sessions_reminder_minutes_check",
      sql`${t.reminderMinutes} IS NULL OR ${t.reminderMinutes} BETWEEN 15 AND 10080`,
    ),
    check(
      "coach_sessions_duration_min_check",
      sql`${t.durationMin} BETWEEN 5 AND 720`,
    ),
  ],
);

export type CoachSession = typeof coachSessions.$inferSelect;

export const coachSessionAttendees = pgTable(
  "coach_session_attendees",
  {
    sessionId: uuid("session_id")
      .notNull()
      .references(() => coachSessions.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    relationshipId: uuid("relationship_id")
      .notNull()
      .references(() => ptClientRelationships.id, { onDelete: "cascade" }),
    status: text("status")
      .$type<CoachSessionAttendeeStatus>()
      .notNull()
      .default("invited"),
    remindedAt: timestamp("reminded_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.sessionId, t.relationshipId] }),
    index("coach_session_attendees_client_idx").on(t.clientId),
    index("coach_session_attendees_relationship_idx").on(t.relationshipId),
    check(
      "coach_session_attendees_status_check",
      sql`${t.status} IN ('invited', 'accepted', 'declined', 'cancelled')`,
    ),
  ],
);

export type CoachSessionAttendee = typeof coachSessionAttendees.$inferSelect;
