import {
  check,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { coachFormResponses, profiles } from "./schema";

// ─── Progress photos and private media (PER-121, design F, migration 8) ─────
// Migration: 20261123230832_progress_photos_private_media.sql. The images live
// in the private CoachPrivateMedia bucket; only the key is stored here.
// Photos are never sent to AI (Brad, 20 Nov 2026).

export const PROGRESS_PHOTO_POSES = ["front", "side", "back"] as const;
export type ProgressPhotoPose = (typeof PROGRESS_PHOTO_POSES)[number];

export const progressPhotoSets = pgTable(
  "progress_photo_sets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    takenOn: date("taken_on").notNull(),
    source: text("source").notNull().default("self"),
    formResponseId: uuid("form_response_id").references(
      () => coachFormResponses.id,
      { onDelete: "set null" },
    ),
    status: text("status").notNull().default("pending"),
    clientRequestId: text("client_request_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("progress_photo_sets_client_request_uq").on(
      t.userId,
      t.clientRequestId,
    ),
    index("progress_photo_sets_user_taken_idx").on(t.userId, t.takenOn.desc()),
    index("progress_photo_sets_user_updated_idx").on(t.userId, t.updatedAt),
    check(
      "progress_photo_sets_source_check",
      sql`${t.source} IN ('self', 'check_in')`,
    ),
    check(
      "progress_photo_sets_status_check",
      sql`${t.status} IN ('pending', 'ready')`,
    ),
  ],
);

export type ProgressPhotoSet = typeof progressPhotoSets.$inferSelect;

export const progressPhotos = pgTable(
  "progress_photos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    setId: uuid("set_id")
      .notNull()
      .references(() => progressPhotoSets.id, { onDelete: "cascade" }),
    pose: text("pose").$type<ProgressPhotoPose>().notNull(),
    s3Key: text("s3_key").notNull(),
    bytes: integer("bytes").notNull(),
    width: integer("width"),
    height: integer("height"),
    status: text("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("progress_photos_set_pose_uq").on(t.setId, t.pose),
    check(
      "progress_photos_pose_check",
      sql`${t.pose} IN ('front', 'side', 'back')`,
    ),
  ],
);

export type ProgressPhoto = typeof progressPhotos.$inferSelect;

export const PRIVATE_MEDIA_PURPOSES = ["form_answer", "resource"] as const;
export type PrivateMediaPurpose = (typeof PRIVATE_MEDIA_PURPOSES)[number];

export const privateMedia = pgTable(
  "private_media",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    purpose: text("purpose").$type<PrivateMediaPurpose>().notNull(),
    s3Key: text("s3_key").notNull(),
    contentType: text("content_type").notNull(),
    bytes: integer("bytes").notNull(),
    status: text("status").notNull().default("pending"),
    formResponseId: uuid("form_response_id").references(
      () => coachFormResponses.id,
      { onDelete: "set null" },
    ),
    clientRequestId: text("client_request_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("private_media_client_request_uq").on(
      t.ownerId,
      t.clientRequestId,
    ),
    index("private_media_owner_created_idx").on(t.ownerId, t.createdAt),
    check(
      "private_media_purpose_check",
      sql`${t.purpose} IN ('form_answer', 'resource')`,
    ),
  ],
);

export type PrivateMedia = typeof privateMedia.$inferSelect;
