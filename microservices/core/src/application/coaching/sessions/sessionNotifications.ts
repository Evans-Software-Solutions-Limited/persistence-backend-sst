import { inArray } from "drizzle-orm";
import { profiles } from "@persistence/db";
import { getDb } from "@persistence/db/client";
import { NotificationDispatcher } from "../../notifications/push/notificationDispatcher";
import { recordCoachEvent } from "../events/coachEvents";
import { safeTimeZone } from "../scheduler/zonedTime";
import type { SessionChange } from "./sessionRepository";

/**
 * Booking announcements (PER-123, design I): creating, moving or cancelling a
 * session writes a `session_booked` coach event per attendee (feed only: the
 * coach made the change, so it never pushes them; Brad, 25 Nov) and pushes
 * each attendee a `coach_session` notification with `data.action`. Runs after
 * the write commits and never throws: the booking is already saved.
 */

export type CoachSessionPushAction =
  | "booked"
  | "moved"
  | "cancelled"
  | "reminder";

const KIND_LABELS: Record<string, string> = {
  in_person: "In person",
  video: "Video call",
  check_in_call: "Check-in call",
  own_training: "Training",
};

export function kindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? "Session";
}

const whenFormatters = new Map<string, Intl.DateTimeFormat>();

/** "Tue 1 Dec, 09:00" in the athlete's zone. */
export function formatWhen(instant: Date, tz: string): string {
  const zone = safeTimeZone(tz);
  let f = whenFormatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    whenFormatters.set(zone, f);
  }
  return f.format(instant);
}

/** One athlete push's title and body. */
export function sessionPushText(
  action: CoachSessionPushAction,
  input: {
    coachName: string;
    kind: string;
    startsAt: Date;
    timeZone: string;
    location?: string | null;
    occurrences?: number;
  },
): { title: string; body: string } {
  const when = formatWhen(input.startsAt, input.timeZone);
  const label = kindLabel(input.kind);
  switch (action) {
    case "booked":
      return {
        title: `${input.coachName} booked a session with you`,
        body:
          input.occurrences && input.occurrences > 1
            ? `${label} · ${when} · weekly, ${input.occurrences} sessions`
            : `${label} · ${when}`,
      };
    case "moved":
      return {
        title: `${input.coachName} moved your session`,
        body: `${label} · now ${when}`,
      };
    case "cancelled":
      return {
        title: `${input.coachName} cancelled your session`,
        body: `${label} · ${when}`,
      };
    case "reminder":
      return {
        title: `Session with ${input.coachName} soon`,
        body: [label, when, input.location?.trim() || null]
          .filter(Boolean)
          .join(" · "),
      };
  }
}

export interface PersonInfo {
  name: string;
  timeZone: string;
}

/** Names and time zones for some profiles. */
export async function peopleInfo(
  ids: string[],
): Promise<Map<string, PersonInfo>> {
  if (ids.length === 0) return new Map();
  const rows = await getDb()
    .select({
      id: profiles.id,
      fullName: profiles.fullName,
      timezone: profiles.timezone,
    })
    .from(profiles)
    .where(inArray(profiles.id, [...new Set(ids)]));
  return new Map(
    rows.map((r) => [
      r.id,
      { name: r.fullName?.trim() || "", timeZone: safeTimeZone(r.timezone) },
    ]),
  );
}

/** Send one athlete push. Never throws. */
export async function pushToAthlete(
  dispatcher: NotificationDispatcher,
  clientId: string,
  action: CoachSessionPushAction,
  text: { title: string; body: string },
  session: { id: string; startsAt: string; seriesId: string | null },
): Promise<boolean> {
  try {
    await dispatcher.createAndDispatch(clientId, {
      type: "coach_session",
      title: text.title,
      message: text.body,
      data: {
        action,
        sessionId: session.id,
        startsAt: session.startsAt,
        seriesId: session.seriesId,
      },
      relatedEntityType: "coach_session",
      relatedEntityId: session.id,
    });
    return true;
  } catch (err) {
    console.warn(`[coach-sessions] push failed for ${session.id}:`, err);
    return false;
  }
}

/** The dedupe key of one change's event for one attendee. */
function dedupeKey(change: SessionChange, relationshipId: string): string {
  const s = change.session;
  // Every write bumps the revision, so each booking, move or cancellation
  // (an attendee taken off, re-added and taken off again) is its own event,
  // while a replay of the same write still dedupes (Inspector Brad, #568).
  return `session_booked:${change.action}:${s.id}:r${s.revision}:${relationshipId}`;
}

/** Events and pushes for some committed changes. Never throws. */
export async function announceSessionChanges(
  trainerId: string,
  changes: SessionChange[],
  dispatcher: NotificationDispatcher = new NotificationDispatcher(),
): Promise<void> {
  if (changes.length === 0) return;
  try {
    const people = await peopleInfo([
      trainerId,
      ...changes.flatMap((c) => c.attendees.map((a) => a.clientId)),
    ]);
    const coachName = people.get(trainerId)?.name || "Your coach";
    for (const change of changes) {
      const s = change.session;
      for (const a of change.attendees) {
        await recordCoachEvent(getDb(), {
          trainerId,
          clientId: a.clientId,
          relationshipId: a.relationshipId,
          kind: "session_booked",
          entityType: "coach_session",
          entityId: s.id,
          payload: {
            action: change.action,
            sessionId: s.id,
            sessionKind: s.kind,
            startsAt: s.startsAt,
            seriesId: s.seriesId,
            occurrences: change.occurrences,
          },
          dedupeKey: dedupeKey(change, a.relationshipId),
          noPush: true,
        });
        const text = sessionPushText(change.action, {
          coachName,
          kind: s.kind,
          startsAt: new Date(s.startsAt),
          timeZone: people.get(a.clientId)?.timeZone ?? safeTimeZone(null),
          occurrences: change.occurrences,
        });
        await pushToAthlete(dispatcher, a.clientId, change.action, text, s);
      }
    }
  } catch (err) {
    console.error("[coach-sessions] announcing a booking change failed", {
      trainerId,
      error: err,
    });
  }
}
