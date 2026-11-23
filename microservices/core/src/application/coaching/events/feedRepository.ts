import {
  and,
  count,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  lt,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import {
  coachEvents,
  coachNotificationSettings,
  profiles,
  ptClientRelationships,
  type CoachEvent,
} from "@persistence/db";
import { getDb } from "@persistence/db/client";
import { hhmm } from "../forms/scheduleRepository";
import { loadCoachPrefs } from "./coachEvents";
import {
  CHANNELS,
  COACH_EVENT_KINDS,
  DEFAULT_CHANNELS,
  TODAY_ACTIONS,
  TODAY_KINDS,
  isCoachEventKind,
  type Channel,
  type CoachEventKind,
} from "./kinds";

/**
 * Reads and marks for the coach's notifications feed, Today and settings
 * (PER-117, design C D4). Every query is filtered by `trainer_id = caller`,
 * so coach B never sees coach A's events. An event about a client is only
 * shown while that coaching relationship is active and the client's account
 * isn't deleted; the one exception is an exit form's response, which stays
 * visible after coaching ends (Brad, 20 Nov).
 */

const clientProfile = profiles;

/**
 * An exit form's response, or the exit form going unanswered: the coach still
 * sees these after coaching ends (Brad, 20 Nov; Inspector Brad, #548).
 */
const exitForm = sql`(${coachEvents.kind} in ('form_completed', 'form_missed')
  and coalesce(${coachEvents.payload} ->> 'trigger', '') = 'on_end')`;

function visible(trainerId: string): SQL {
  return and(
    eq(coachEvents.trainerId, trainerId),
    or(
      isNull(coachEvents.relationshipId),
      and(
        eq(ptClientRelationships.status, "active"),
        isNull(clientProfile.deletedAt),
      ),
      and(exitForm, isNull(clientProfile.deletedAt)),
    ),
  )!;
}

const columns = {
  event: coachEvents,
  clientName: clientProfile.fullName,
  clientAvatarUrl: clientProfile.avatarUrl,
};

function base() {
  return getDb()
    .select(columns)
    .from(coachEvents)
    .leftJoin(
      ptClientRelationships,
      eq(ptClientRelationships.id, coachEvents.relationshipId),
    )
    .leftJoin(clientProfile, eq(clientProfile.id, coachEvents.clientId));
}

type Row = {
  event: CoachEvent;
  clientName: string | null;
  clientAvatarUrl: string | null;
};

export interface CoachEventDTO {
  id: string;
  kind: string;
  client: { id: string; name: string | null; avatarUrl: string | null } | null;
  relationshipId: string | null;
  entityType: string | null;
  entityId: string | null;
  payload: Record<string, unknown>;
  occurredAt: string;
  readAt: string | null;
  actionedAt: string | null;
  /** True when Today offers an action for this kind. */
  actionable: boolean;
}

function dto(row: Row): CoachEventDTO {
  const e = row.event;
  return {
    id: e.id,
    kind: e.kind,
    client: e.clientId
      ? { id: e.clientId, name: row.clientName, avatarUrl: row.clientAvatarUrl }
      : null,
    relationshipId: e.relationshipId,
    entityType: e.entityType,
    entityId: e.entityId,
    payload: e.payload,
    occurredAt: e.occurredAt.toISOString(),
    readAt: e.readAt ? e.readAt.toISOString() : null,
    actionedAt: e.actionedAt ? e.actionedAt.toISOString() : null,
    actionable: e.kind in TODAY_ACTIONS,
  };
}

// ─── Feed ────────────────────────────────────────────────────────────────────

export const FEED_DEFAULT_LIMIT = 50;
export const FEED_MAX_LIMIT = 200;

export function encodeCursor(e: { occurredAt: Date; id: string }): string {
  return Buffer.from(`${e.occurredAt.toISOString()}|${e.id}`).toString(
    "base64url",
  );
}

export function decodeCursor(
  raw: string,
): { occurredAt: Date; id: string } | null {
  const [at, id] = Buffer.from(raw, "base64url").toString("utf8").split("|");
  const occurredAt = new Date(at ?? "");
  if (!id || Number.isNaN(occurredAt.getTime())) return null;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return { occurredAt, id };
}

export interface FeedQuery {
  kinds?: CoachEventKind[];
  clientId?: string;
  since?: Date;
  cursor?: { occurredAt: Date; id: string };
  limit: number;
}

export interface FeedPage {
  data: CoachEventDTO[];
  nextCursor: string | null;
  unreadCount: number;
  /** With `since`: events hidden since then (their coaching ended). */
  deletedIds?: string[];
}

export async function listFeed(
  trainerId: string,
  q: FeedQuery,
): Promise<FeedPage> {
  const filters: SQL[] = [visible(trainerId)];
  if (q.kinds && q.kinds.length > 0) {
    filters.push(inArray(coachEvents.kind, q.kinds));
  }
  if (q.clientId) filters.push(eq(coachEvents.clientId, q.clientId));
  if (q.since) filters.push(gt(coachEvents.updatedAt, q.since));
  if (q.cursor) {
    filters.push(
      or(
        lt(coachEvents.occurredAt, q.cursor.occurredAt),
        and(
          eq(coachEvents.occurredAt, q.cursor.occurredAt),
          lt(coachEvents.id, q.cursor.id),
        ),
      )!,
    );
  }
  const rows = (await base()
    .where(and(...filters))
    .orderBy(desc(coachEvents.occurredAt), desc(coachEvents.id))
    .limit(q.limit + 1)) as Row[];
  const page = rows.slice(0, q.limit);
  const last = page[page.length - 1];
  const unread = await getDb()
    .select({ n: count() })
    .from(coachEvents)
    .leftJoin(
      ptClientRelationships,
      eq(ptClientRelationships.id, coachEvents.relationshipId),
    )
    .leftJoin(clientProfile, eq(clientProfile.id, coachEvents.clientId))
    .where(and(visible(trainerId), isNull(coachEvents.readAt)));
  const out: FeedPage = {
    data: page.map(dto),
    nextCursor: rows.length > q.limit && last ? encodeCursor(last.event) : null,
    unreadCount: Number(unread[0]?.n ?? 0),
  };
  if (q.since) {
    const hidden = await getDb()
      .select({ id: coachEvents.id })
      .from(coachEvents)
      .innerJoin(
        ptClientRelationships,
        eq(ptClientRelationships.id, coachEvents.relationshipId),
      )
      .where(
        and(
          eq(coachEvents.trainerId, trainerId),
          ne(ptClientRelationships.status, "active"),
          gt(ptClientRelationships.updatedAt, q.since),
          ...(q.clientId ? [eq(coachEvents.clientId, q.clientId)] : []),
          // `exitForm` coalesces the trigger, so the NOT is never NULL.
          sql`not ${exitForm}`,
        ),
      )
      .limit(FEED_MAX_LIMIT * 5);
    out.deletedIds = hidden.map((h) => h.id);
  }
  return out;
}

/** `{ids}` or every unread event. Idempotent: returns how many changed. */
export async function markRead(
  trainerId: string,
  ids: string[] | "all",
  now: Date = new Date(),
): Promise<number> {
  if (ids !== "all" && ids.length === 0) return 0;
  const updated = await getDb()
    .update(coachEvents)
    .set({ readAt: now, updatedAt: now })
    .where(
      and(
        eq(coachEvents.trainerId, trainerId),
        isNull(coachEvents.readAt),
        ...(ids === "all" ? [] : [inArray(coachEvents.id, ids)]),
      ),
    )
    .returning({ id: coachEvents.id });
  return updated.length;
}

// ─── Today ───────────────────────────────────────────────────────────────────

export const TODAY_LIMIT = 100;

export interface TodayItem {
  eventId: string;
  kind: string;
  client: CoachEventDTO["client"];
  facts: Record<string, unknown>;
  action: string;
  occurredAt: string;
  readAt: string | null;
}

export async function todayQueue(trainerId: string): Promise<{
  queue: TodayItem[];
  counts: { total: number; byKind: Record<string, number> };
}> {
  // Today only offers actions that can still be taken. After coaching ends,
  // visible() lets only exit forms through: an answered one can still be
  // reviewed, but a client who left can't be nudged (Inspector Brad, #548).
  const filter = and(
    visible(trainerId),
    or(
      isNull(coachEvents.relationshipId),
      eq(ptClientRelationships.status, "active"),
      ne(coachEvents.kind, "form_missed"),
    ),
    inArray(coachEvents.kind, TODAY_KINDS),
    isNull(coachEvents.actionedAt),
  );
  const rows = (await base()
    .where(filter)
    .orderBy(desc(coachEvents.occurredAt), desc(coachEvents.id))
    .limit(TODAY_LIMIT)) as Row[];
  const grouped = await getDb()
    .select({ kind: coachEvents.kind, n: count() })
    .from(coachEvents)
    .leftJoin(
      ptClientRelationships,
      eq(ptClientRelationships.id, coachEvents.relationshipId),
    )
    .leftJoin(clientProfile, eq(clientProfile.id, coachEvents.clientId))
    .where(filter)
    .groupBy(coachEvents.kind);
  const byKind: Record<string, number> = {};
  let total = 0;
  for (const g of grouped) {
    byKind[g.kind] = Number(g.n);
    total += Number(g.n);
  }
  return {
    queue: rows.map((r) => {
      const d = dto(r);
      return {
        eventId: d.id,
        kind: d.kind,
        client: d.client,
        facts: d.payload,
        action: TODAY_ACTIONS[d.kind as CoachEventKind]!,
        occurredAt: d.occurredAt,
        readAt: d.readAt,
      };
    }),
    counts: { total, byKind },
  };
}

/**
 * Marks a Today item done (and read). Idempotent: a second call returns the
 * first time. null when the event isn't the caller's.
 */
export async function markActioned(
  trainerId: string,
  eventId: string,
  now: Date = new Date(),
): Promise<{ eventId: string; actionedAt: string } | null> {
  const updated = await getDb()
    .update(coachEvents)
    .set({
      actionedAt: sql`coalesce(${coachEvents.actionedAt}, ${now.toISOString()}::timestamptz)`,
      readAt: sql`coalesce(${coachEvents.readAt}, ${now.toISOString()}::timestamptz)`,
      updatedAt: now,
    })
    .where(
      and(eq(coachEvents.id, eventId), eq(coachEvents.trainerId, trainerId)),
    )
    .returning({ actionedAt: coachEvents.actionedAt });
  const row = updated[0];
  if (!row?.actionedAt) return null;
  return { eventId, actionedAt: new Date(row.actionedAt).toISOString() };
}

// ─── Settings (C6) ───────────────────────────────────────────────────────────

export interface NotificationSettingsDTO {
  /** Every kind with its channel (the coach's choice, else the default). */
  channels: Record<CoachEventKind, Channel>;
  defaults: Record<CoachEventKind, Channel>;
  quietHours: { enabled: boolean; from: string | null; until: string | null };
  /** The coach's profile time zone, which quiet hours use. */
  timeZone: string;
  /** Email is hidden until a provider is added (Brad, 20 Nov). */
  emailAvailable: false;
  revision: number;
  updatedAt: string | null;
}

export async function getSettings(
  trainerId: string,
): Promise<NotificationSettingsDTO> {
  const db = getDb();
  const prefs = await loadCoachPrefs(db, trainerId);
  const rows = await db
    .select({
      revision: coachNotificationSettings.revision,
      updatedAt: coachNotificationSettings.updatedAt,
    })
    .from(coachNotificationSettings)
    .where(eq(coachNotificationSettings.trainerId, trainerId))
    .limit(1);
  const channels = {} as Record<CoachEventKind, Channel>;
  for (const kind of COACH_EVENT_KINDS) {
    const chosen = prefs.channels[kind];
    channels[kind] =
      chosen && (CHANNELS as readonly string[]).includes(chosen)
        ? chosen
        : DEFAULT_CHANNELS[kind];
  }
  return {
    channels,
    defaults: { ...DEFAULT_CHANNELS },
    quietHours: {
      enabled: prefs.quietEnabled,
      from: prefs.quietFrom,
      until: prefs.quietUntil,
    },
    timeZone: prefs.timeZone,
    emailAvailable: false,
    revision: rows[0]?.revision ?? 0,
    updatedAt: rows[0]?.updatedAt ? rows[0].updatedAt.toISOString() : null,
  };
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export interface SettingsInput {
  channels?: Record<string, string>;
  quietHours?: {
    enabled: boolean;
    from?: string | null;
    until?: string | null;
  };
  expectedRevision?: number;
}

export type SettingsResult =
  | { ok: true; settings: NotificationSettingsDTO }
  | { ok: false; status: 400; code: "invalid_settings"; message: string }
  | {
      ok: false;
      status: 409;
      code: "revision_conflict";
      current: NotificationSettingsDTO;
    };

export function checkSettings(input: SettingsInput): string | null {
  for (const [kind, channel] of Object.entries(input.channels ?? {})) {
    if (!isCoachEventKind(kind)) return `unknown event kind: ${kind}`;
    if (!(CHANNELS as readonly string[]).includes(channel)) {
      return `channel must be one of ${CHANNELS.join(", ")}`;
    }
  }
  const q = input.quietHours;
  if (q) {
    for (const t of [q.from, q.until]) {
      if (t !== undefined && t !== null && !TIME.test(t)) {
        return "quiet hours must be HH:MM";
      }
    }
    if (q.enabled && (!q.from || !q.until)) {
      return "quiet hours need from and until";
    }
    if (q.enabled && q.from === q.until) {
      return "quiet hours from and until must differ";
    }
  }
  return null;
}

/** PUT: merges `channels` into the stored map; replaces quiet hours. */
export async function putSettings(
  trainerId: string,
  input: SettingsInput,
  now: Date = new Date(),
): Promise<SettingsResult> {
  const invalid = checkSettings(input);
  if (invalid) {
    return {
      ok: false,
      status: 400,
      code: "invalid_settings",
      message: invalid,
    };
  }
  const conflict = await getDb().transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(coachNotificationSettings)
      .where(eq(coachNotificationSettings.trainerId, trainerId))
      .limit(1)
      .for("update");
    const row = rows[0];
    const current = row?.revision ?? 0;
    if (
      input.expectedRevision !== undefined &&
      input.expectedRevision !== current
    ) {
      return true;
    }
    const channels = { ...(row?.channels ?? {}), ...(input.channels ?? {}) };
    const q = input.quietHours;
    const quiet = q
      ? {
          quietEnabled: q.enabled,
          quietFrom: q.from ?? null,
          quietUntil: q.until ?? null,
        }
      : {
          quietEnabled: row?.quietEnabled ?? false,
          quietFrom: hhmm(row?.quietFrom),
          quietUntil: hhmm(row?.quietUntil),
        };
    if (!row) {
      const inserted = await tx
        .insert(coachNotificationSettings)
        .values({ trainerId, channels, ...quiet, revision: 1, updatedAt: now })
        .onConflictDoNothing()
        .returning({ trainerId: coachNotificationSettings.trainerId });
      // Another first save won the race: the caller's view is stale.
      return inserted.length === 0;
    }
    await tx
      .update(coachNotificationSettings)
      .set({ channels, ...quiet, revision: current + 1, updatedAt: now })
      .where(eq(coachNotificationSettings.trainerId, trainerId));
    return false;
  });
  const settings = await getSettings(trainerId);
  if (conflict) {
    return {
      ok: false,
      status: 409,
      code: "revision_conflict",
      current: settings,
    };
  }
  return { ok: true, settings };
}
