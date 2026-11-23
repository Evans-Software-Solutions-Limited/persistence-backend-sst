import { and, eq, inArray } from "drizzle-orm";
import {
  coachClientSettings,
  coachEvents,
  coachNotificationSettings,
  profiles,
  type CoachEvent,
} from "@persistence/db";
import { getDb } from "@persistence/db/client";
import type { DbOrTx } from "../../repositories/personalRecordsRepository";
import { NotificationDispatcher } from "../../notifications/push/notificationDispatcher";
import { hhmm } from "../forms/scheduleRepository";
import { isQuietAt, safeTimeZone } from "../scheduler/zonedTime";
import {
  COACH_PUSH_DEEP_LINK,
  DEFAULT_CHANNELS,
  isCoachEventKind,
  pushText,
  type Channel,
  type CoachEventKind,
} from "./kinds";

/**
 * Coach events (PER-117, design C D4): one row per thing that happened with a
 * coach's client. It feeds the coach's notifications and Today, and decides
 * the push:
 *
 *  - a muted client (`alert_mode = 'mute'`) is recorded and never pushed;
 *  - `everything` pushes every kind;
 *  - otherwise the coach's channel for the kind (or its default) decides;
 *  - a push during the coach's quiet hours is held, and the scheduler sends
 *    one push per client when the window ends.
 *
 * Every write is `ON CONFLICT (trainer_id, dedupe_key) DO NOTHING`, so a
 * writer that runs twice (a retried request, an overlapping tick) records
 * one event. Pushes are claimed (`pending`/`held` → `sent`) before they are
 * sent, so a push goes out once.
 */

export interface CoachEventInput {
  trainerId: string;
  clientId: string | null;
  relationshipId: string | null;
  kind: CoachEventKind;
  entityType?: string | null;
  entityId?: string | null;
  payload?: Record<string, unknown>;
  occurredAt?: Date;
  dedupeKey: string;
  /**
   * The path already pushes this to the coach its own way (the personal-code
   * accept's "Client accepted"), so the event is feed and Today only.
   */
  noPush?: boolean;
}

export interface CoachNotificationPrefs {
  channels: Record<string, Channel>;
  quietEnabled: boolean;
  quietFrom: string | null;
  quietUntil: string | null;
  timeZone: string;
}

/** A coach's settings, with defaults when they never saved any. */
export async function loadCoachPrefs(
  db: DbOrTx,
  trainerId: string,
): Promise<CoachNotificationPrefs> {
  const rows = await db
    .select({
      channels: coachNotificationSettings.channels,
      quietEnabled: coachNotificationSettings.quietEnabled,
      quietFrom: coachNotificationSettings.quietFrom,
      quietUntil: coachNotificationSettings.quietUntil,
      timeZone: profiles.timezone,
    })
    .from(profiles)
    .leftJoin(
      coachNotificationSettings,
      eq(coachNotificationSettings.trainerId, profiles.id),
    )
    .where(eq(profiles.id, trainerId))
    .limit(1);
  const row = rows[0];
  return {
    channels: (row?.channels ?? {}) as Record<string, Channel>,
    quietEnabled: row?.quietEnabled ?? false,
    quietFrom: hhmm(row?.quietFrom),
    quietUntil: hhmm(row?.quietUntil),
    timeZone: safeTimeZone(row?.timeZone),
  };
}

export function isCoachQuiet(
  prefs: CoachNotificationPrefs,
  now: Date,
): boolean {
  return (
    prefs.quietEnabled &&
    isQuietAt(now, prefs.timeZone, prefs.quietFrom, prefs.quietUntil)
  );
}

export function channelFor(
  prefs: Pick<CoachNotificationPrefs, "channels">,
  kind: CoachEventKind,
): Channel {
  return prefs.channels[kind] ?? DEFAULT_CHANNELS[kind];
}

/** The push state a new event starts in. */
export function initialPushState(
  kind: CoachEventKind,
  alertMode: string,
  prefs: CoachNotificationPrefs,
  now: Date,
): CoachEvent["pushState"] {
  if (alertMode === "mute") return "skipped";
  const channel = alertMode === "everything" ? "push" : channelFor(prefs, kind);
  if (channel !== "push" && channel !== "both") return "none";
  return isCoachQuiet(prefs, now) ? "held" : "pending";
}

async function alertModeFor(
  db: DbOrTx,
  trainerId: string,
  relationshipId: string | null,
): Promise<string> {
  if (!relationshipId) return "default";
  const rows = await db
    .select({ alertMode: coachClientSettings.alertMode })
    .from(coachClientSettings)
    .where(
      and(
        eq(coachClientSettings.relationshipId, relationshipId),
        eq(coachClientSettings.trainerId, trainerId),
      ),
    )
    .limit(1);
  return rows[0]?.alertMode ?? "default";
}

/**
 * Record one event. Returns its id when this call created it and it should be
 * pushed now (`pending`), so the caller can `deliverCoachEvents` after its
 * transaction commits; null otherwise (a duplicate, held, muted or in-app
 * only). A `pending` event the caller never delivers is swept up by the
 * scheduler.
 */
export async function recordCoachEvent(
  db: DbOrTx,
  input: CoachEventInput,
  now: Date = new Date(),
): Promise<string | null> {
  if (!isCoachEventKind(input.kind)) {
    throw new Error(`unknown coach event kind: ${input.kind}`);
  }
  const prefs = await loadCoachPrefs(db, input.trainerId);
  const alertMode = await alertModeFor(
    db,
    input.trainerId,
    input.relationshipId,
  );
  const pushState = input.noPush
    ? "none"
    : initialPushState(input.kind, alertMode, prefs, now);
  const inserted = await db
    .insert(coachEvents)
    .values({
      trainerId: input.trainerId,
      clientId: input.clientId,
      relationshipId: input.relationshipId,
      kind: input.kind,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      payload: input.payload ?? {},
      occurredAt: input.occurredAt ?? now,
      pushState,
      dedupeKey: input.dedupeKey,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .returning({ id: coachEvents.id, pushState: coachEvents.pushState });
  const row = inserted[0];
  return row && row.pushState === "pending" ? row.id : null;
}

/** The names pushes use: the client's name, else the coach's label. */
async function clientNames(clientIds: string[]): Promise<Map<string, string>> {
  if (clientIds.length === 0) return new Map();
  const rows = await getDb()
    .select({ id: profiles.id, fullName: profiles.fullName })
    .from(profiles)
    .where(inArray(profiles.id, clientIds));
  return new Map(rows.map((r) => [r.id, r.fullName?.trim() || "Your client"]));
}

function nameOf(names: Map<string, string>, clientId: string | null): string {
  return (clientId && names.get(clientId)) || "Your client";
}

/** Send one coach push into the coach's own inbox. Never throws. */
async function pushToCoach(
  dispatcher: NotificationDispatcher,
  trainerId: string,
  title: string,
  body: string,
  data: Record<string, unknown>,
  relatedEventId: string,
): Promise<boolean> {
  try {
    await dispatcher.createAndDispatch(trainerId, {
      type: "coach_event",
      title,
      message: body,
      data: { ...data, deepLink: COACH_PUSH_DEEP_LINK },
      relatedEntityType: "coach_event",
      relatedEntityId: relatedEventId,
    });
    return true;
  } catch (err) {
    console.warn(`[coach-events] push failed for ${relatedEventId}:`, err);
    return false;
  }
}

/**
 * Push events that are `pending`: each is claimed (`pending` → `sent`) first,
 * so two callers never push the same event. Best-effort and never throws.
 */
export async function deliverCoachEvents(
  eventIds: string[],
  dispatcher: NotificationDispatcher = new NotificationDispatcher(),
): Promise<number> {
  if (eventIds.length === 0) return 0;
  try {
    const claimed = await getDb()
      .update(coachEvents)
      .set({ pushState: "sent" })
      .where(
        and(
          inArray(coachEvents.id, eventIds),
          eq(coachEvents.pushState, "pending"),
        ),
      )
      .returning();
    const names = await clientNames([
      ...new Set(claimed.flatMap((e) => (e.clientId ? [e.clientId] : []))),
    ]);
    let sent = 0;
    for (const e of claimed) {
      const text = pushText(e.kind, nameOf(names, e.clientId), e.payload);
      const ok = await pushToCoach(
        dispatcher,
        e.trainerId,
        text.title,
        text.body,
        { eventIds: [e.id], kind: e.kind, clientId: e.clientId },
        e.id,
      );
      if (ok) sent += 1;
    }
    return sent;
  } catch (err) {
    console.warn("[coach-events] delivery failed:", err);
    return 0;
  }
}

/**
 * Quiet hours ended: one push per client for everything held ("Sam: 3
 * updates"). `events` are already claimed (`held` → `sent`) by the caller.
 */
export async function pushHeldGroup(
  trainerId: string,
  clientId: string | null,
  events: CoachEvent[],
  dispatcher: NotificationDispatcher,
): Promise<boolean> {
  const names = await clientNames(clientId ? [clientId] : []);
  const name = nameOf(names, clientId);
  const first = events[0]!;
  const text =
    events.length === 1
      ? pushText(first.kind, name, first.payload)
      : { title: `${name}: ${events.length} updates`, body: "" };
  return pushToCoach(
    dispatcher,
    trainerId,
    text.title,
    text.body,
    {
      eventIds: events.map((e) => e.id),
      kind: events.length === 1 ? first.kind : "grouped",
      clientId,
    },
    first.id,
  );
}
