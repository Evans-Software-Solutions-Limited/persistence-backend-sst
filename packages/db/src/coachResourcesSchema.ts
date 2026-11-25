import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { profiles, ptClientRelationships } from "./schema";
import { privateMedia } from "./progressPhotosSchema";

// ─── Coach resources (PER-122, design I, migration 10 resources part) ───────
// Migration: 20261125101829_coach_resources.sql. Files live in the private
// CoachPrivateMedia bucket through `private_media` (purpose 'resource');
// links are https only.

export const COACH_RESOURCE_KINDS = ["file", "link"] as const;
export type CoachResourceKind = (typeof COACH_RESOURCE_KINDS)[number];

export const coachResources = pgTable(
  "coach_resources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    trainerId: uuid("trainer_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    kind: text("kind").$type<CoachResourceKind>().notNull(),
    title: text("title").notNull(),
    url: text("url"),
    mediaId: uuid("media_id").references(() => privateMedia.id, {
      onDelete: "set null",
    }),
    mime: text("mime"),
    bytes: integer("bytes"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
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
    uniqueIndex("coach_resources_client_request_uq").on(
      t.trainerId,
      t.clientRequestId,
    ),
    index("coach_resources_trainer_updated_idx").on(t.trainerId, t.updatedAt),
    check(
      "coach_resources_kind_ck",
      sql`(${t.kind} = 'link' AND ${t.url} IS NOT NULL AND ${t.mediaId} IS NULL) OR (${t.kind} = 'file' AND ${t.url} IS NULL)`,
    ),
  ],
);

export type CoachResource = typeof coachResources.$inferSelect;

export const coachResourceAssignments = pgTable(
  "coach_resource_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    resourceId: uuid("resource_id")
      .notNull()
      .references(() => coachResources.id, { onDelete: "cascade" }),
    trainerId: uuid("trainer_id").notNull(),
    clientId: uuid("client_id").notNull(),
    relationshipId: uuid("relationship_id")
      .notNull()
      .references(() => ptClientRelationships.id, { onDelete: "cascade" }),
    assignedAt: timestamp("assigned_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    openedAt: timestamp("opened_at", { withTimezone: true }),
    removedAt: timestamp("removed_at", { withTimezone: true }),
    clientRequestId: text("client_request_id"),
  },
  (t) => [
    uniqueIndex("coach_resource_assignments_live_uq")
      .on(t.resourceId, t.relationshipId)
      .where(sql`removed_at IS NULL`),
    index("coach_resource_assignments_relationship_idx").on(t.relationshipId),
    index("coach_resource_assignments_client_idx").on(t.clientId),
    index("coach_resource_assignments_trainer_client_idx").on(
      t.trainerId,
      t.clientId,
    ),
  ],
);

export type CoachResourceAssignment =
  typeof coachResourceAssignments.$inferSelect;
