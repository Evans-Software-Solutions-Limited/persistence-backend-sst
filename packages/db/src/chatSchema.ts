import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { ptClientRelationships } from "./schema";

// ─── Coach–client chat (PER-120, design E, migration 7) ──────────────────────
// Migration: 20261125162525_chat_channels.sql. One Stream channel per
// coach–client relationship; message content lives in Stream only.

export const CHAT_CHANNEL_STATES = ["pending", "active", "frozen"] as const;
export type ChatChannelState = (typeof CHAT_CHANNEL_STATES)[number];

export const chatChannels = pgTable(
  "chat_channels",
  {
    relationshipId: uuid("relationship_id")
      .primaryKey()
      .references(() => ptClientRelationships.id, { onDelete: "cascade" }),
    streamChannelType: text("stream_channel_type")
      .$type<"coaching">()
      .notNull()
      .default("coaching"),
    streamChannelId: text("stream_channel_id").notNull(),
    trainerId: uuid("trainer_id").notNull(),
    clientId: uuid("client_id").notNull(),
    state: text("state").$type<ChatChannelState>().notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    frozenAt: timestamp("frozen_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("chat_channels_stream_channel_uq").on(
      t.streamChannelType,
      t.streamChannelId,
    ),
    index("chat_channels_trainer_idx").on(t.trainerId),
    index("chat_channels_client_idx").on(t.clientId),
  ],
);

export type ChatChannel = typeof chatChannels.$inferSelect;
export type NewChatChannel = typeof chatChannels.$inferInsert;
