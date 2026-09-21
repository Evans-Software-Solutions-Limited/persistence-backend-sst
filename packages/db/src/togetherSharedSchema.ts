import {
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { profiles } from "./schema";

/** Ordered per-athlete locks shared by sessions, friendship and safety mutations. */
export const togetherActors = pgTable("together_actors", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => profiles.id, { onDelete: "cascade" }),
});
export const togetherReceipts = pgTable(
  "together_receipts",
  {
    actorId: uuid("actor_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    route: text("route").notNull(),
    key: uuid("key").notNull(),
    requestHash: text("request_hash").notNull(),
    result: jsonb("result").$type<unknown>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.actorId, t.route, t.key] })],
);
export const togetherRateLimits = pgTable(
  "together_rate_limits",
  {
    actorId: uuid("actor_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    bucket: text("bucket").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    attempts: integer("attempts").notNull(),
  },
  (t) => [primaryKey({ columns: [t.actorId, t.bucket] })],
);
