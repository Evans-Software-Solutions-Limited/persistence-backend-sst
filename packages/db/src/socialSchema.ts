import {
  boolean,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { profiles, workouts } from "./schema";

export type SharedTemplatePlan = {
  name: string;
  exercises: {
    planExerciseId: string;
    exerciseId: string;
    order: number;
    targetSets: number;
    targetReps?: number;
  }[];
};
export const socialProfiles = pgTable("social_profiles", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => profiles.id, { onDelete: "cascade" }),
  discoverable: boolean("discoverable").notNull().default(false),
});
export const socialBlocks = pgTable(
  "social_blocks",
  {
    actorId: uuid("actor_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    subjectId: uuid("subject_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.actorId, t.subjectId] })],
);
export const socialReports = pgTable("social_reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  actorId: uuid("actor_id")
    .notNull()
    .references(() => profiles.id, { onDelete: "cascade" }),
  subjectId: uuid("subject_id")
    .notNull()
    .references(() => profiles.id, { onDelete: "cascade" }),
  context: text("context").notNull(),
  resourceId: uuid("resource_id"),
  reason: text("reason").notNull(),
  details: text("details"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const togetherTemplateShares = pgTable("together_template_shares", {
  id: uuid("id").primaryKey().defaultRandom(),
  senderId: uuid("sender_id")
    .notNull()
    .references(() => profiles.id, { onDelete: "cascade" }),
  recipientId: uuid("recipient_id")
    .notNull()
    .references(() => profiles.id, { onDelete: "cascade" }),
  plan: jsonb("plan").$type<SharedTemplatePlan>().notNull(),
  revoked: boolean("revoked").notNull().default(false),
});
export const togetherTemplateCopies = pgTable(
  "together_template_copies",
  {
    shareId: uuid("share_id")
      .notNull()
      .references(() => togetherTemplateShares.id, { onDelete: "cascade" }),
    recipientId: uuid("recipient_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    workoutId: uuid("workout_id").references(() => workouts.id, {
      onDelete: "set null",
    }),
  },
  (t) => [primaryKey({ columns: [t.shareId, t.recipientId] })],
);
/** Rejection/removal tombstone preserves receipt authority without restoring friendship. */
export const socialRequestDecisions = pgTable("social_request_decisions", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => profiles.id, { onDelete: "cascade" }),
  friendId: uuid("friend_id")
    .notNull()
    .references(() => profiles.id, { onDelete: "cascade" }),
  initiatedBy: uuid("initiated_by")
    .notNull()
    .references(() => profiles.id, { onDelete: "cascade" }),
});
