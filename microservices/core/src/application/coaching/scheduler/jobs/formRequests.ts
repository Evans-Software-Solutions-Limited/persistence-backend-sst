import {
  and,
  asc,
  eq,
  gt,
  isNotNull,
  isNull,
  lt,
  lte,
  or,
  sql,
} from "drizzle-orm";
import {
  coachFormRequests,
  coachFormScheduleClients,
  coachFormSchedules,
  coachForms,
  notifications,
  profiles,
} from "@persistence/db";
import { getDb } from "@persistence/db/client";
import { deliverCoachEvents, recordCoachEvent } from "../../events/coachEvents";
import type { SchedulerJob } from "../coachScheduler";

/**
 * The athlete side of forms (PER-117, design C D2):
 *  - `missed_forms`: a pending request past its due date becomes `missed`,
 *    with a `form_missed` event for the coach;
 *  - `form_pushes`: a push for each new request (`form_request`), and the
 *    rule's reminders (`form_reminder`), each sent once and only while the
 *    request is pending, the rule is active and the client isn't paused.
 *
 * Pushes go to the athlete's inbox as ordinary notifications. 1.2.0 phones
 * show the unknown types with the generic row (D5, checked); they carry no
 * deep link, so a tap on 1.2.0 opens Home rather than an unknown route.
 */

const HOUR_MS = 60 * 60 * 1000;
export const MAX_ROWS = 500;
/** A new request older than this is never announced (the job was down). */
const ANNOUNCE_WINDOW_MS = 48 * HOUR_MS;
/** Reminders reach at most 720 hours after the send (`MAX_REMINDER_HOURS`). */
const REMINDER_WINDOW_MS = 31 * 24 * HOUR_MS;

export const missedFormsJob: SchedulerJob = {
  name: "missed_forms",
  cadence: "tick",
  async run({ now, dispatcher }) {
    const db = getDb();
    const due = await db
      .select({
        id: coachFormRequests.id,
        trainerId: coachFormRequests.trainerId,
        clientId: coachFormRequests.clientId,
        relationshipId: coachFormRequests.relationshipId,
        formId: coachFormRequests.formId,
        trigger: coachFormRequests.trigger,
        title: coachForms.title,
      })
      .from(coachFormRequests)
      .innerJoin(coachForms, eq(coachForms.id, coachFormRequests.formId))
      .where(
        and(
          eq(coachFormRequests.status, "pending"),
          isNotNull(coachFormRequests.dueAt),
          lt(coachFormRequests.dueAt, now),
        ),
      )
      .orderBy(asc(coachFormRequests.dueAt))
      .limit(MAX_ROWS);
    let missed = 0;
    const events: string[] = [];
    for (const r of due) {
      const eventId = await db.transaction(async (tx) => {
        const updated = await tx
          .update(coachFormRequests)
          .set({ status: "missed", updatedAt: now })
          .where(
            and(
              eq(coachFormRequests.id, r.id),
              eq(coachFormRequests.status, "pending"),
            ),
          )
          .returning({ id: coachFormRequests.id });
        if (updated.length === 0) return null;
        missed += 1;
        return recordCoachEvent(
          tx,
          {
            trainerId: r.trainerId,
            clientId: r.clientId,
            relationshipId: r.relationshipId,
            kind: "form_missed",
            entityType: "coach_form_request",
            entityId: r.id,
            payload: {
              requestId: r.id,
              formId: r.formId,
              formTitle: r.title,
              trigger: r.trigger,
            },
            dedupeKey: `form_missed:${r.id}`,
          },
          now,
        );
      });
      if (eventId) events.push(eventId);
    }
    await deliverCoachEvents(events, dispatcher);
    return { missed };
  },
};

/** Who sent it, for the push title. */
const coachName = sql<string | null>`(
  select ${profiles.fullName} from ${profiles}
  where ${profiles.id} = ${coachFormRequests.trainerId}
)`;

const stillOpen = (now: Date) =>
  and(
    eq(coachFormRequests.status, "pending"),
    or(isNull(coachFormRequests.dueAt), gt(coachFormRequests.dueAt, now)),
  );

async function announceNew(
  now: Date,
  dispatcher: SchedulerJobContext["dispatcher"],
): Promise<number> {
  const db = getDb();
  const rows = await db
    .select({
      id: coachFormRequests.id,
      clientId: coachFormRequests.clientId,
      formId: coachFormRequests.formId,
      dueAt: coachFormRequests.dueAt,
      title: coachForms.title,
      coachName,
    })
    .from(coachFormRequests)
    .innerJoin(coachForms, eq(coachForms.id, coachFormRequests.formId))
    .where(
      and(
        stillOpen(now),
        gt(
          coachFormRequests.sentAt,
          new Date(now.getTime() - ANNOUNCE_WINDOW_MS),
        ),
        lte(coachFormRequests.sentAt, now),
        sql`not exists (
          select 1 from ${notifications}
          where ${notifications.userId} = ${coachFormRequests.clientId}
            and ${notifications.type} = 'form_request'
            and ${notifications.relatedEntityId} = ${coachFormRequests.id}
        )`,
      ),
    )
    .orderBy(asc(coachFormRequests.sentAt))
    .limit(MAX_ROWS);
  for (const r of rows) {
    await dispatcher.createAndDispatch(r.clientId, {
      type: "form_request",
      title: `${r.coachName?.trim() || "Your coach"} sent you ${r.title}`,
      message: "Open the app to fill it in.",
      data: {
        requestId: r.id,
        formId: r.formId,
        dueAt: r.dueAt ? r.dueAt.toISOString() : null,
      },
      relatedEntityType: "coach_form_request",
      relatedEntityId: r.id,
    });
  }
  return rows.length;
}

interface Reminder {
  afterHours: number;
}

/** A rule's reminders, sorted; anything malformed is ignored. */
export function reminderList(value: unknown): Reminder[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (r): r is Reminder =>
        typeof r === "object" &&
        r !== null &&
        typeof (r as Reminder).afterHours === "number",
    )
    .sort((a, b) => a.afterHours - b.afterHours);
}

async function sendReminders(
  now: Date,
  dispatcher: SchedulerJobContext["dispatcher"],
): Promise<number> {
  const db = getDb();
  const rows = await db
    .select({
      id: coachFormRequests.id,
      clientId: coachFormRequests.clientId,
      formId: coachFormRequests.formId,
      sentAt: coachFormRequests.sentAt,
      dueAt: coachFormRequests.dueAt,
      remindersSent: coachFormRequests.remindersSent,
      ruleReminders: coachFormSchedules.reminders,
      override: coachFormScheduleClients.override,
      targetStatus: coachFormScheduleClients.status,
      title: coachForms.title,
      coachName,
    })
    .from(coachFormRequests)
    .innerJoin(
      coachFormSchedules,
      eq(coachFormSchedules.id, coachFormRequests.scheduleId),
    )
    .innerJoin(coachForms, eq(coachForms.id, coachFormRequests.formId))
    .leftJoin(
      coachFormScheduleClients,
      and(
        eq(coachFormScheduleClients.scheduleId, coachFormRequests.scheduleId),
        eq(
          coachFormScheduleClients.relationshipId,
          coachFormRequests.relationshipId,
        ),
      ),
    )
    .where(
      and(
        stillOpen(now),
        eq(coachFormSchedules.status, "active"),
        or(
          isNull(coachFormScheduleClients.status),
          eq(coachFormScheduleClients.status, "active"),
        ),
        gt(
          coachFormRequests.sentAt,
          new Date(now.getTime() - REMINDER_WINDOW_MS),
        ),
        sql`${coachFormRequests.remindersSent} < jsonb_array_length(
          case when jsonb_typeof(${coachFormScheduleClients.override} -> 'reminders') = 'array'
               then ${coachFormScheduleClients.override} -> 'reminders'
               else ${coachFormSchedules.reminders} end
        )`,
      ),
    )
    .orderBy(asc(coachFormRequests.sentAt))
    .limit(MAX_ROWS);
  let sent = 0;
  for (const r of rows) {
    const list = reminderList(
      Array.isArray(r.override?.reminders)
        ? r.override.reminders
        : r.ruleReminders,
    );
    const due = list.filter(
      (x) => r.sentAt.getTime() + x.afterHours * HOUR_MS <= now.getTime(),
    ).length;
    if (due <= r.remindersSent) continue;
    // Claim: only the caller that moves the counter sends. Several reminders
    // falling due at once (the job was down) send one push, not a burst.
    const claimed = await db
      .update(coachFormRequests)
      .set({ remindersSent: due, updatedAt: now })
      .where(
        and(
          eq(coachFormRequests.id, r.id),
          eq(coachFormRequests.remindersSent, r.remindersSent),
          eq(coachFormRequests.status, "pending"),
        ),
      )
      .returning({ id: coachFormRequests.id });
    if (claimed.length === 0) continue;
    await dispatcher.createAndDispatch(r.clientId, {
      type: "form_reminder",
      title: `Reminder: ${r.title}`,
      message: `${r.coachName?.trim() || "Your coach"} is waiting for your answers.`,
      data: {
        requestId: r.id,
        formId: r.formId,
        reminder: due,
        dueAt: r.dueAt ? r.dueAt.toISOString() : null,
      },
      relatedEntityType: "coach_form_request",
      relatedEntityId: r.id,
    });
    sent += 1;
  }
  return sent;
}

type SchedulerJobContext = Parameters<SchedulerJob["run"]>[0];

export const formPushesJob: SchedulerJob = {
  name: "form_pushes",
  cadence: "tick",
  async run({ now, dispatcher }) {
    const announced = await announceNew(now, dispatcher);
    const reminded = await sendReminders(now, dispatcher);
    return { announced, reminded };
  },
};
