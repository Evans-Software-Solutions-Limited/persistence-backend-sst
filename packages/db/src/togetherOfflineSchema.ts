import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  jsonb,
  primaryKey,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { profiles } from "./schema";
import type { TogetherPlan, TogetherExecution } from "./togetherSchema";
export const togetherOfflineDevices = pgTable(
  "together_offline_devices",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    deviceId: uuid("device_id").notNull(),
    publicKey: text("public_key").notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.deviceId] })],
);
export const togetherOfflineExecutions = pgTable(
  "together_offline_executions",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    executionId: uuid("execution_id").notNull(),
    sessionId: uuid("session_id").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    plan: jsonb("plan").$type<TogetherPlan>().notNull(),
    planHash: text("plan_hash").notNull(),
    revision: integer("revision").notNull().default(0),
    execution: jsonb("execution").$type<TogetherExecution>().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.executionId] }),
    uniqueIndex("together_offline_owner_session_idx").on(t.userId, t.sessionId),
  ],
);
export const togetherOfflineCommands = pgTable(
  "together_offline_commands",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    commandId: uuid("command_id").notNull(),
    executionId: uuid("execution_id").notNull(),
    requestHash: text("request_hash").notNull(),
    revision: integer("revision").notNull(),
    command: jsonb("command").$type<unknown>().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.commandId] }),
    uniqueIndex("together_offline_execution_revision_idx").on(
      t.userId,
      t.executionId,
      t.revision,
    ),
  ],
);
