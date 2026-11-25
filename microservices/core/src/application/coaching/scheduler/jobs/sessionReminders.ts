import { and, asc, eq, gt, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import {
  coachSessionAttendees,
  coachSessions,
  ptClientRelationships,
} from "@persistence/db";
import { getDb } from "@persistence/db/client";
import type { SchedulerJob } from "../coachScheduler";
import { BOOKED_STATUSES } from "../../sessions/sessionRepository";
import {
  peopleInfo,
  pushToAthlete,
  sessionPushText,
} from "../../sessions/sessionNotifications";
import { safeTimeZone } from "../zonedTime";

/**
 * Session reminders (PER-123, design I): each booked attendee (invited or
 * accepted, on an active relationship) of a session that isn't cancelled is
 * pushed once, from `starts_at − reminder_minutes` until the session starts.
 *
 * Each reminder is claimed (`reminded_at` set where it was NULL) before it is
 * pushed, so overlapping runs and retries send it once. Times are instants,
 * so a clock change never shifts a reminder; moving a session or changing its
 * reminder time clears `reminded_at` so the new time is reminded.
 */

/** Reminders per read. Mutable only so tests can use tiny pages. */
export const REMINDER_PAGE = { size: 500 };

export const sessionRemindersJob: SchedulerJob = {
  name: "session_reminders",
  cadence: "tick",
  async run({ now, dispatcher }) {
    const db = getDb();
    let sent = 0;
    let claimed = 0;
    // Claimed rows drop out of the next read, so each page is new and the
    // loop drains every due reminder (Inspector Brad, #548).
    for (;;) {
      const due = await db
        .select({
          sessionId: coachSessions.id,
          trainerId: coachSessions.trainerId,
          kind: coachSessions.kind,
          startsAt: coachSessions.startsAt,
          location: coachSessions.location,
          seriesId: coachSessions.seriesId,
          clientId: coachSessionAttendees.clientId,
          relationshipId: coachSessionAttendees.relationshipId,
        })
        .from(coachSessionAttendees)
        .innerJoin(
          coachSessions,
          eq(coachSessions.id, coachSessionAttendees.sessionId),
        )
        .innerJoin(
          ptClientRelationships,
          eq(ptClientRelationships.id, coachSessionAttendees.relationshipId),
        )
        .where(
          and(
            isNull(coachSessions.cancelledAt),
            isNotNull(coachSessions.reminderMinutes),
            gt(coachSessions.startsAt, now),
            sql`${coachSessions.startsAt} - make_interval(mins => ${coachSessions.reminderMinutes}) <= ${now.toISOString()}::timestamptz`,
            isNull(coachSessionAttendees.remindedAt),
            inArray(coachSessionAttendees.status, BOOKED_STATUSES),
            eq(ptClientRelationships.status, "active"),
          ),
        )
        .orderBy(
          asc(coachSessions.startsAt),
          asc(coachSessionAttendees.sessionId),
          asc(coachSessionAttendees.relationshipId),
        )
        .limit(REMINDER_PAGE.size);
      if (due.length === 0) break;
      const people = await peopleInfo(
        due.flatMap((r) => [r.trainerId, r.clientId]),
      );
      for (const r of due) {
        const won = await db
          .update(coachSessionAttendees)
          .set({ remindedAt: now, updatedAt: now })
          .where(
            and(
              eq(coachSessionAttendees.sessionId, r.sessionId),
              eq(coachSessionAttendees.relationshipId, r.relationshipId),
              isNull(coachSessionAttendees.remindedAt),
            ),
          )
          .returning({ sessionId: coachSessionAttendees.sessionId });
        if (won.length === 0) continue;
        claimed += 1;
        const text = sessionPushText("reminder", {
          coachName: people.get(r.trainerId)?.name || "your coach",
          kind: r.kind,
          startsAt: r.startsAt,
          timeZone: people.get(r.clientId)?.timeZone ?? safeTimeZone(null),
          location: r.location,
        });
        const ok = await pushToAthlete(
          dispatcher,
          r.clientId,
          "reminder",
          text,
          {
            id: r.sessionId,
            startsAt: r.startsAt.toISOString(),
            seriesId: r.seriesId,
          },
        );
        if (ok) sent += 1;
      }
      if (due.length < REMINDER_PAGE.size) break;
    }
    return { claimed, sent };
  },
};
