import {
  aliasedTable,
  and,
  asc,
  eq,
  exists,
  inArray,
  isNull,
  ne,
  or,
  sql,
} from "drizzle-orm";
import {
  chatChannels,
  coachClientProfiles,
  coachClientSetupItems,
  profiles,
  ptClientRelationships,
  type ChatChannel,
} from "@persistence/db";
import { getDb } from "@persistence/db/client";
import {
  isNotFound,
  STREAM_CHANNEL_TYPE,
  streamClientFromEnv,
  type StreamChatClient,
  type StreamUser,
} from "./streamClient";

/**
 * One Stream channel per coach–client relationship (PER-120, design E).
 *
 * The relationship decides what the channel should be, and `chat_channels`
 * records where it is:
 *
 *  - relationship ACTIVE → channel `active`: trainer and client are members
 *    and it isn't frozen. Provisioning gets it there (idempotent: the id is
 *    `coach-<relationshipId>`, so every step can be re-run).
 *  - relationship ended → channel `frozen`: the client is removed and the
 *    channel frozen, so the coach keeps a read-only thread (C9d) and the
 *    athlete loses it.
 *
 * Both are tried straight away (provisioning after an accept commits,
 * freezing after `endCoachClientRelationship` commits) and, when Stream is
 * down or the path that changed the relationship has no hook, the coach
 * scheduler's `chat_channels` job converges them (`reconcileChatChannels`).
 * A channel that isn't provisioned yet is `pending`.
 *
 * With chat not configured (empty Stream keys) every entry point here is a
 * no-op that touches neither Stream nor the database. Once the keys are set,
 * the scheduler job provisions every active relationship, which is also how
 * relationships that predate chat get their channel.
 */

/** Deterministic Stream channel id for a relationship. */
export function channelIdFor(relationshipId: string): string {
  return `coach-${relationshipId}`;
}

/** Test seam: replaces the env-built client (null = not configured). */
let clientOverride: StreamChatClient | null | undefined;
export function setStreamClientForTests(
  client: StreamChatClient | null | undefined,
): void {
  clientOverride = client;
  channelTypeReady = null;
}

export function getStreamClient(): StreamChatClient | null {
  return clientOverride !== undefined ? clientOverride : streamClientFromEnv();
}

/**
 * The `coaching` channel type (with its member-only grants) is ensured once
 * per Lambda container, on first use rather than at import, before any
 * channel is created in it. A failure is not remembered, so the next
 * provisioning (or scheduler tick) tries again.
 */
let channelTypeReady: Promise<void> | null = null;
export function ensureCoachingChannelType(
  client: StreamChatClient,
): Promise<void> {
  if (!channelTypeReady) {
    channelTypeReady = client.ensureChannelType().catch((err: unknown) => {
      channelTypeReady = null;
      throw err;
    });
  }
  return channelTypeReady;
}

interface Party {
  id: string;
  fullName: string | null;
  avatarUrl: string | null;
  deletedAt: Date | null;
}

export function streamUserFor(p: {
  id: string;
  fullName: string | null;
  avatarUrl: string | null;
}): StreamUser {
  return {
    id: p.id,
    name: p.fullName?.trim() || undefined,
    image: p.avatarUrl || undefined,
  };
}

async function loadParty(id: string): Promise<Party | null> {
  const rows = await getDb()
    .select({
      id: profiles.id,
      fullName: profiles.fullName,
      avatarUrl: profiles.avatarUrl,
      deletedAt: profiles.deletedAt,
    })
    .from(profiles)
    .where(eq(profiles.id, id))
    .limit(1);
  return rows[0] ?? null;
}

const relationshipIsActive = (relationshipId: string) =>
  exists(
    getDb()
      .select({ one: sql`1` })
      .from(ptClientRelationships)
      .where(
        and(
          eq(ptClientRelationships.id, relationshipId),
          eq(ptClientRelationships.status, "active"),
        ),
      ),
  );

/**
 * The coach's set-up welcome message for this relationship, if any (PER-108
 * set-up hook): posted as the channel's first message. Its Stream message id
 * is fixed by the set-up item, so a retry never posts it twice.
 */
async function welcomeMessageFor(
  relationshipId: string,
  trainerId: string,
): Promise<{ id: string; text: string } | null> {
  const rows = await getDb()
    .select({
      itemId: coachClientSetupItems.id,
      config: coachClientSetupItems.config,
    })
    .from(coachClientSetupItems)
    .innerJoin(
      coachClientProfiles,
      eq(coachClientProfiles.id, coachClientSetupItems.profileId),
    )
    .where(
      and(
        eq(coachClientProfiles.relationshipId, relationshipId),
        eq(coachClientProfiles.trainerId, trainerId),
        eq(coachClientProfiles.status, "active"),
        eq(coachClientSetupItems.section, "welcome_message"),
      ),
    )
    .limit(1);
  const row = rows[0];
  const text =
    typeof row?.config.text === "string" ? row.config.text.trim() : "";
  if (!row || !text) return null;
  return { id: `welcome-${row.itemId}`, text };
}

export type ProvisionResult =
  | "not_configured"
  | "not_active"
  | "provisioned"
  | "ended_meanwhile";

/**
 * Bring a relationship's channel to `active`. Throws when Stream fails (the
 * row stays `pending`, or `frozen` for a revived relationship, and the
 * scheduler retries); see `safeProvisionChatChannel` for hooks.
 */
export async function provisionChatChannel(
  relationshipId: string,
  now: Date = new Date(),
): Promise<ProvisionResult> {
  const client = getStreamClient();
  if (!client) return "not_configured";
  const db = getDb();

  const rels = await db
    .select({
      trainerId: ptClientRelationships.trainerId,
      clientId: ptClientRelationships.clientId,
      status: ptClientRelationships.status,
      isAiTrainer: ptClientRelationships.isAiTrainer,
    })
    .from(ptClientRelationships)
    .where(eq(ptClientRelationships.id, relationshipId))
    .limit(1);
  const rel = rels[0];
  if (!rel || rel.status !== "active" || rel.isAiTrainer) return "not_active";
  const [trainer, athlete] = await Promise.all([
    loadParty(rel.trainerId),
    loadParty(rel.clientId),
  ]);
  if (!trainer || !athlete || trainer.deletedAt || athlete.deletedAt) {
    return "not_active";
  }

  const channelId = channelIdFor(relationshipId);
  await db
    .insert(chatChannels)
    .values({
      relationshipId,
      streamChannelType: STREAM_CHANNEL_TYPE,
      streamChannelId: channelId,
      trainerId: rel.trainerId,
      clientId: rel.clientId,
      state: "pending",
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing();

  try {
    await ensureCoachingChannelType(client);
    await client.upsertUsers([streamUserFor(trainer), streamUserFor(athlete)]);
    await client.getOrCreateChannel(channelId, rel.trainerId, [
      rel.trainerId,
      rel.clientId,
    ]);
    // A revived relationship: the client comes back and the thread opens.
    await client.addMembers(channelId, [rel.trainerId, rel.clientId]);
    await client.setFrozen(channelId, false);
    const welcome = await welcomeMessageFor(relationshipId, rel.trainerId);
    if (welcome) {
      await client.sendMessage(channelId, {
        id: welcome.id,
        text: welcome.text,
        userId: rel.trainerId,
      });
    }
  } catch (err) {
    // Rotates this row to the back of the scheduler's retry queue.
    await db
      .update(chatChannels)
      .set({ updatedAt: now })
      .where(
        and(
          eq(chatChannels.relationshipId, relationshipId),
          ne(chatChannels.state, "active"),
        ),
      );
    throw err;
  }

  const updated = await db
    .update(chatChannels)
    .set({
      state: "active",
      trainerId: rel.trainerId,
      clientId: rel.clientId,
      frozenAt: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(chatChannels.relationshipId, relationshipId),
        relationshipIsActive(relationshipId),
      ),
    )
    .returning({ relationshipId: chatChannels.relationshipId });
  if (updated.length === 0) {
    // Coaching ended while Stream was being called: freeze it again now.
    await freezeChatChannel(relationshipId, now);
    return "ended_meanwhile";
  }
  return "provisioned";
}

export type FreezeResult =
  | "not_configured"
  | "no_channel"
  | "still_active"
  | "frozen";

/**
 * Coaching ended: remove the client and freeze the channel; the coach keeps
 * reading. Throws when Stream fails (the row keeps its state, so the
 * scheduler retries); see `safeFreezeChatChannel` for hooks. Only this
 * relationship's channel is touched: the same athlete's channel with another
 * coach is a different row and a different Stream channel.
 */
export async function freezeChatChannel(
  relationshipId: string,
  now: Date = new Date(),
): Promise<FreezeResult> {
  const client = getStreamClient();
  if (!client) return "not_configured";
  const db = getDb();
  const rows = await db
    .select()
    .from(chatChannels)
    .where(eq(chatChannels.relationshipId, relationshipId))
    .limit(1);
  const row = rows[0];
  if (!row) return "no_channel";
  const rel = await db
    .select({ status: ptClientRelationships.status })
    .from(ptClientRelationships)
    .where(eq(ptClientRelationships.id, relationshipId))
    .limit(1);
  if (rel[0]?.status === "active") return "still_active";

  try {
    await client.removeMembers(row.streamChannelId, [row.clientId]);
    await client.setFrozen(row.streamChannelId, true);
  } catch (err) {
    // Never created in Stream (provisioning never got that far): nothing
    // there to freeze.
    if (!isNotFound(err)) throw err;
  }
  await db
    .update(chatChannels)
    .set({ state: "frozen", frozenAt: row.frozenAt ?? now, updatedAt: now })
    .where(eq(chatChannels.relationshipId, relationshipId));
  return "frozen";
}

export type EraseResult = "not_configured" | "erased";

/**
 * Account purge (Inspector Brad, #570): erase a PURGED user from Stream.
 * Their `chat_channels` rows are already gone (they cascade with the purge),
 * so the channels are found in Stream itself: the user is removed from each
 * `coaching` channel they're a member of and it is frozen (the other party
 * keeps a read-only thread of their own messages); then the Stream user is
 * hard-deleted with all their messages.
 *
 * ⚠ Irreversible, so it runs only AFTER the purge has committed: the nightly
 * private-media drain calls it for users whose profile is gone, through the
 * same durable queue (`private_media_purges`, PER-121). A restored account is
 * dropped from the queue and never reaches Stream (see
 * `account/purge/eraseAfterPurge.ts`).
 *
 * Idempotent (a channel or user Stream no longer has counts as done) and it
 * throws on a Stream failure, so the queued row stays and the next night
 * retries. A no-op when chat isn't configured.
 */
export async function eraseChatUser(userId: string): Promise<EraseResult> {
  const client = getStreamClient();
  if (!client) return "not_configured";
  for (const channelId of await client.coachingChannelsOf(userId)) {
    try {
      await client.removeMembers(channelId, [userId]);
      await client.setFrozen(channelId, true);
    } catch (err) {
      if (!isNotFound(err)) throw err;
    }
  }
  const deleted = await client.deleteUserHard(userId);
  if (deleted === "pending") throw new StreamDeletePendingError(userId);
  return "erased";
}

/**
 * Stream accepted the user delete but hasn't finished it. Not a failure: the
 * queued row stays and the next night re-submits it; a user Stream no longer
 * has then counts as done (Inspector Brad, #570).
 */
export class StreamDeletePendingError extends Error {
  constructor(userId: string) {
    super(`Stream is still deleting user ${userId}`);
    this.name = "StreamDeletePendingError";
  }
}

/** Provisioning for a hook after a commit. Never throws. */
export async function safeProvisionChatChannel(
  relationshipId: string,
): Promise<void> {
  try {
    await provisionChatChannel(relationshipId);
  } catch (err) {
    console.warn(
      `[chat] provisioning ${relationshipId} failed; the scheduler retries`,
      err,
    );
  }
}

/** Freezing for a hook after a commit. Never throws. */
export async function safeFreezeChatChannel(
  relationshipId: string,
): Promise<void> {
  try {
    await freezeChatChannel(relationshipId);
  } catch (err) {
    console.warn(
      `[chat] freezing ${relationshipId} failed; the scheduler retries`,
      err,
    );
  }
}

export const RECONCILE_BATCH = 50;

export interface ReconcileSummary {
  notConfigured: number;
  /** The channel type ensure failed this tick: provisioning was skipped. */
  ensureFailed: number;
  provisioned: number;
  provisionFailed: number;
  frozen: number;
  freezeFailed: number;
}

/**
 * The scheduler's retry (design E: "retries from `pending`"): channels whose
 * relationship is active but which aren't `active` (or don't exist yet), and
 * `active` channels whose relationship has ended. Bounded per tick; a failure
 * is logged and retried next tick, and never stops the others.
 */
export async function reconcileChatChannels(
  now: Date = new Date(),
  limit: number = RECONCILE_BATCH,
): Promise<ReconcileSummary> {
  const summary: ReconcileSummary = {
    notConfigured: 0,
    ensureFailed: 0,
    provisioned: 0,
    provisionFailed: 0,
    frozen: 0,
    freezeFailed: 0,
  };
  const client = getStreamClient();
  if (!client) {
    summary.notConfigured = 1;
    return summary;
  }
  // Every tick (memoised per container), so a deploy locks the channel
  // types down even before any new channel is provisioned. If it fails,
  // provisioning waits for the next tick; freezing still runs.
  let typesReady = true;
  try {
    await ensureCoachingChannelType(client);
  } catch (err) {
    typesReady = false;
    summary.ensureFailed = 1;
    console.error("[chat] channel type ensure failed", err);
  }
  const db = getDb();
  const trainer = aliasedTable(profiles, "chat_trainer");
  const athlete = aliasedTable(profiles, "chat_athlete");

  const toProvision = !typesReady
    ? []
    : await db
        .select({ id: ptClientRelationships.id })
        .from(ptClientRelationships)
        .innerJoin(trainer, eq(trainer.id, ptClientRelationships.trainerId))
        .innerJoin(athlete, eq(athlete.id, ptClientRelationships.clientId))
        .leftJoin(
          chatChannels,
          eq(chatChannels.relationshipId, ptClientRelationships.id),
        )
        .where(
          and(
            eq(ptClientRelationships.status, "active"),
            eq(ptClientRelationships.isAiTrainer, false),
            isNull(trainer.deletedAt),
            isNull(athlete.deletedAt),
            or(
              isNull(chatChannels.relationshipId),
              ne(chatChannels.state, "active"),
            ),
          ),
        )
        // Never-tried first, then the longest-waiting retries.
        .orderBy(sql`${chatChannels.updatedAt} asc nulls first`)
        .limit(limit);
  for (const { id } of toProvision) {
    try {
      const result = await provisionChatChannel(id, now);
      if (result === "provisioned") summary.provisioned += 1;
    } catch (err) {
      summary.provisionFailed += 1;
      console.error(`[chat] provisioning ${id} failed`, err);
    }
  }

  const toFreeze = await db
    .select({ id: chatChannels.relationshipId })
    .from(chatChannels)
    .innerJoin(
      ptClientRelationships,
      eq(ptClientRelationships.id, chatChannels.relationshipId),
    )
    .where(
      and(
        eq(chatChannels.state, "active"),
        ne(ptClientRelationships.status, "active"),
      ),
    )
    .orderBy(asc(chatChannels.updatedAt))
    .limit(limit);
  for (const { id } of toFreeze) {
    try {
      if ((await freezeChatChannel(id, now)) === "frozen") summary.frozen += 1;
    } catch (err) {
      summary.freezeFailed += 1;
      console.error(`[chat] freezing ${id} failed`, err);
    }
  }
  return summary;
}

export interface ChatChannelView {
  relationshipId: string;
  channelId: string;
  otherParty: { id: string; name: string | null; avatarUrl: string | null };
  state: "active" | "frozen";
}

/**
 * The caller's channels (design E `GET /chat/channels`). As the coach:
 * active and frozen. As the athlete: active only, and only while the
 * relationship is active (a freeze that hasn't reached Stream yet still
 * hides it). Scoped to the caller's own relationships; nothing else.
 */
export async function listChannelsFor(
  userId: string,
): Promise<ChatChannelView[]> {
  const db = getDb();
  const rows = await db
    .select({
      channel: chatChannels,
      relationshipStatus: ptClientRelationships.status,
    })
    .from(chatChannels)
    .innerJoin(
      ptClientRelationships,
      eq(ptClientRelationships.id, chatChannels.relationshipId),
    )
    .where(
      or(
        and(
          eq(chatChannels.trainerId, userId),
          inArray(chatChannels.state, ["active", "frozen"]),
        ),
        and(
          eq(chatChannels.clientId, userId),
          eq(chatChannels.state, "active"),
          eq(ptClientRelationships.status, "active"),
        ),
      ),
    )
    .orderBy(asc(chatChannels.createdAt));
  const visible: ChatChannel[] = rows.map((r) => r.channel);
  const otherIds = [
    ...new Set(
      visible.map((c) => (c.trainerId === userId ? c.clientId : c.trainerId)),
    ),
  ];
  const others =
    otherIds.length === 0
      ? []
      : await db
          .select({
            id: profiles.id,
            fullName: profiles.fullName,
            avatarUrl: profiles.avatarUrl,
          })
          .from(profiles)
          .where(inArray(profiles.id, otherIds));
  const byId = new Map(others.map((p) => [p.id, p]));
  return visible.map((c) => {
    const otherId = c.trainerId === userId ? c.clientId : c.trainerId;
    const other = byId.get(otherId);
    return {
      relationshipId: c.relationshipId,
      channelId: c.streamChannelId,
      otherParty: {
        id: otherId,
        name: other?.fullName ?? null,
        avatarUrl: other?.avatarUrl ?? null,
      },
      state: c.state as "active" | "frozen",
    };
  });
}

/** The chat row for a Stream channel id, or null. */
export async function channelByStreamId(
  channelId: string,
): Promise<ChatChannel | null> {
  const rows = await getDb()
    .select()
    .from(chatChannels)
    .where(
      and(
        eq(chatChannels.streamChannelType, STREAM_CHANNEL_TYPE),
        eq(chatChannels.streamChannelId, channelId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}
