import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  primaryKey,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { profiles, workoutSessions } from "./schema";
export interface TogetherPlan {
  name: string;
  exercises: {
    planExerciseId: string;
    exerciseId: string;
    order: number;
    targetSets: number;
    targetReps?: number;
  }[];
}
export interface TogetherExerciseDefinition {
  recordingExerciseId?: string;
  name: string;
  category:
    | "strength"
    | "cardio"
    | "flexibility"
    | "balance"
    | "plyometric"
    | "olympic"
    | "mobility"
    | null;
  primaryMuscles: string[];
  createdBy: string | null;
}
export interface TogetherSet {
  setId: string;
  reps: number;
  weightKg: number;
  completed: boolean;
}
export interface TogetherExecution {
  exercises: {
    planExerciseId: string;
    substituteExerciseId?: string | null;
    skipped: boolean;
    sets: TogetherSet[];
    everAcknowledged?: boolean;
  }[];
  restEndsAt?: string | null;
}
const at = (name: string) => timestamp(name, { withTimezone: true });
export const togetherSessions = pgTable(
  "together_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hostId: uuid("host_id").references(() => profiles.id, {
      onDelete: "set null",
    }),
    clientDraftId: uuid("client_draft_id").notNull(),
    promotionHash: text("promotion_hash").notNull(),
    state: text("state").notNull().default("active"),
    revision: integer("revision").notNull().default(1),
    planVersion: integer("plan_version").notNull().default(1),
    plan: jsonb("plan").$type<TogetherPlan>().notNull(),
    audience: text("audience").notNull().default("private"),
    placeId: text("place_id"),
    placeLabel: text("place_label"),
    expiresAt: at("expires_at").notNull(),
    collaborationRevoked: boolean("collaboration_revoked")
      .notNull()
      .default(false),
    createdAt: at("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("together_sessions_promotion_idx").on(
      t.hostId,
      t.clientDraftId,
    ),
    index("together_sessions_discovery_idx").on(t.audience, t.expiresAt),
  ],
);
export const togetherParticipants = pgTable(
  "together_participants",
  {
    sessionId: uuid("session_id")
      .notNull()
      .references(() => togetherSessions.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("active"),
    ownRevision: integer("own_revision").notNull().default(0),
    delegationGeneration: integer("delegation_generation").notNull().default(0),
    allowPartnerLogging: boolean("allow_partner_logging")
      .notNull()
      .default(false),
    execution: jsonb("execution").$type<TogetherExecution>().notNull(),
    exerciseDefinitions: jsonb("exercise_definitions")
      .$type<Record<string, TogetherExerciseDefinition>>()
      .notNull()
      .default({}),
    frozenPlan: jsonb("frozen_plan").$type<TogetherPlan>(),
    consentVersion: text("consent_version").notNull(),
    leftAt: at("left_at"),
    historyId: uuid("history_id").references(() => workoutSessions.id, {
      onDelete: "set null",
    }),
    joinedAt: at("joined_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.sessionId, t.userId] }),
    uniqueIndex("together_one_unfinished_idx")
      .on(t.userId)
      .where(sql`${t.status} in ('active','finalizing')`),
  ],
);
export const togetherInvites = pgTable("together_invites", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionId: uuid("session_id")
    .notNull()
    .references(() => togetherSessions.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  audience: text("audience").notNull().default("private"),
  revokedFor: uuid("revoked_for").array().notNull().default([]),
  expiresAt: at("expires_at").notNull(),
  revoked: boolean("revoked").notNull().default(false),
  consumed: boolean("consumed").notNull().default(false),
});
export const togetherJoinRequests = pgTable(
  "together_join_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => togetherSessions.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    inviteId: uuid("invite_id").references(() => togetherInvites.id),
    consentVersion: text("consent_version").notNull(),
    status: text("status").notNull().default("pending"),
    createdAt: at("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("together_pending_request_idx")
      .on(t.sessionId, t.userId)
      .where(sql`${t.status} = 'pending'`),
  ],
);
export const togetherCommands = pgTable(
  "together_commands",
  {
    sessionId: uuid("session_id")
      .notNull()
      .references(() => togetherSessions.id, { onDelete: "cascade" }),
    commandId: uuid("command_id").notNull(),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    requestHash: text("request_hash").notNull(),
    result: jsonb("result").notNull(),
  },
  (t) => [primaryKey({ columns: [t.sessionId, t.commandId] })],
);
export const togetherEvents = pgTable(
  "together_events",
  {
    sessionId: uuid("session_id")
      .notNull()
      .references(() => togetherSessions.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull(),
    event: jsonb("event").notNull(),
    createdAt: at("created_at").notNull().defaultNow(),
    dispatchedAt: at("dispatched_at"),
  },
  (t) => [
    primaryKey({ columns: [t.sessionId, t.revision] }),
    index("together_events_pending_idx")
      .on(t.createdAt)
      .where(sql`${t.dispatchedAt} is null`),
  ],
);
export const togetherJobs = pgTable(
  "together_jobs",
  {
    sessionId: uuid("session_id")
      .notNull()
      .references(() => togetherSessions.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    clientRecordId: uuid("client_record_id").notNull().defaultRandom().unique(),
    status: text("status").notNull().default("pending"),
    completedAt: at("completed_at").notNull().defaultNow(),
    effectsDone: boolean("effects_done").notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.sessionId, t.userId] })],
);
export const togetherTickets = pgTable("together_tickets", {
  tokenHash: text("token_hash").primaryKey(),
  sessionId: uuid("session_id")
    .notNull()
    .references(() => togetherSessions.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => profiles.id, { onDelete: "cascade" }),
  expiresAt: at("expires_at").notNull(),
  used: boolean("used").notNull().default(false),
});
export const togetherConnections = pgTable(
  "together_connections",
  {
    connectionId: text("connection_id").primaryKey(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => togetherSessions.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    expiresAt: at("expires_at").notNull(),
    revoked: boolean("revoked").notNull().default(false),
  },
  (t) => [index("together_connections_session_idx").on(t.sessionId)],
);
