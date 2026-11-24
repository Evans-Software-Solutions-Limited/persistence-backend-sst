import { and, asc, eq, gt, inArray, lt, ne, or, sql } from "drizzle-orm";
import {
  coachFormRequests,
  coachFormScheduleClients,
  coachFormSchedules,
  coachForms,
  profiles,
  type CoachFormSchedule,
} from "@persistence/db";
import { getDb } from "@persistence/db/client";
import {
  effectiveDueAfterHours,
  effectiveTrigger,
  insertRequests,
  liveVersions,
  scheduleTargets,
} from "../../forms/generators";
import { hhmm } from "../../forms/scheduleRepository";
import { deliverCoachEvents, recordCoachEvent } from "../../events/coachEvents";
import type { SchedulerJob } from "../coachScheduler";
import { PAGE_SIZES } from "./pageSizes";
import {
  addDays,
  isoWeekKey,
  localDateIn,
  mondayOf,
  safeTimeZone,
  zonedInstant,
} from "../zonedTime";

/**
 * Weekly and daily forms (PER-117, design C D2): a period goes out on the
 * first run at or after the rule's weekday and time in the ATHLETE's zone.
 * Generating a period marks that client's earlier pending request from the
 * same rule `missed`.
 *
 * Period keys are the ISO week (`2026-W47`) and the local date
 * (`2026-11-19`); the unique request key makes every send once-only.
 *
 * A period is only sent while it is fresh (`GRACE_MS` after its time), and
 * never for a time before the client's coaching or the rule began, so a new
 * client or a new rule waits for the next period instead of getting one
 * straight away.
 */

const GRACE_MS = 6 * 60 * 60 * 1000;

export interface Period {
  key: string;
  at: Date;
}

interface PeriodRule {
  weekday: number | null;
  timeLocal: string | null;
}

/**
 * The current and previous periods of a rule, in `tz`, whose send time has
 * passed and is still within the grace window.
 */
export function duePeriods(
  trigger: "weekly" | "daily",
  rule: PeriodRule,
  tz: string,
  now: Date,
): Period[] {
  if (!rule.timeLocal) return [];
  const today = localDateIn(now, tz);
  const dates: string[] = [];
  if (trigger === "daily") {
    dates.push(addDays(today, -1), today);
  } else {
    if (!rule.weekday) return [];
    const thisWeek = addDays(mondayOf(today), rule.weekday - 1);
    dates.push(addDays(thisWeek, -7), thisWeek);
  }
  const out: Period[] = [];
  for (const date of dates) {
    const at = zonedInstant(date, rule.timeLocal, tz);
    if (at <= now && now.getTime() - at.getTime() <= GRACE_MS) {
      out.push({ key: trigger === "daily" ? date : isoWeekKey(date), at });
    }
  }
  return out;
}

function ruleFor(
  schedule: CoachFormSchedule,
  override: Record<string, unknown> | null,
): PeriodRule {
  const weekday =
    typeof override?.weekday === "number" ? override.weekday : schedule.weekday;
  const timeLocal =
    typeof override?.timeLocal === "string"
      ? override.timeLocal
      : hhmm(schedule.timeLocal);
  return { weekday, timeLocal };
}

async function timeZones(clientIds: string[]): Promise<Map<string, string>> {
  if (clientIds.length === 0) return new Map();
  const rows = await getDb()
    .select({ id: profiles.id, tz: profiles.timezone })
    .from(profiles)
    .where(inArray(profiles.id, clientIds));
  return new Map(rows.map((r) => [r.id, safeTimeZone(r.tz)]));
}

/**
 * The client's earlier pending requests from this rule become missed, with a
 * `form_missed` event for the coach. Returns the count and the events to
 * push.
 */
async function missEarlier(
  schedule: CoachFormSchedule,
  trigger: "weekly" | "daily",
  relationshipId: string,
  clientId: string,
  currentKey: string,
  now: Date,
): Promise<{ missed: number; events: string[] }> {
  const db = getDb();
  const current = await db
    .select({ sentAt: coachFormRequests.sentAt })
    .from(coachFormRequests)
    .where(
      and(
        eq(coachFormRequests.relationshipId, relationshipId),
        eq(coachFormRequests.formId, schedule.formId),
        eq(coachFormRequests.trigger, trigger),
        eq(coachFormRequests.periodKey, currentKey),
      ),
    )
    .limit(1);
  // The latest period's own request: only requests sent before it are
  // earlier periods. (It always exists here: its insert has just run, and
  // requests are never deleted.)
  if (!current[0]) return { missed: 0, events: [] };
  const before = current[0].sentAt;
  // One transaction: the missed status and its event commit together, so a
  // failed event write rolls the status back and the next tick retries both
  // (Inspector Brad, #548). The caller pushes after the commit.
  return db.transaction(async (tx) => {
    const missed = await tx
      .update(coachFormRequests)
      .set({ status: "missed", updatedAt: now })
      .where(
        and(
          eq(coachFormRequests.relationshipId, relationshipId),
          eq(coachFormRequests.formId, schedule.formId),
          eq(coachFormRequests.trigger, trigger),
          eq(coachFormRequests.status, "pending"),
          ne(coachFormRequests.periodKey, currentKey),
          lt(coachFormRequests.sentAt, before),
        ),
      )
      .returning({ id: coachFormRequests.id });
    const title = await tx
      .select({ title: coachForms.title })
      .from(coachForms)
      .where(eq(coachForms.id, schedule.formId))
      .limit(1);
    const events: string[] = [];
    for (const r of missed) {
      const id = await recordCoachEvent(
        tx,
        {
          trainerId: schedule.trainerId,
          clientId,
          relationshipId,
          kind: "form_missed",
          entityType: "coach_form_request",
          entityId: r.id,
          payload: {
            requestId: r.id,
            formId: schedule.formId,
            // The request's form: its FK guarantees the row.
            formTitle: title[0]!.title,
            trigger,
          },
          dedupeKey: `form_missed:${r.id}`,
        },
        now,
      );
      if (id) events.push(id);
    }
    return { missed: missed.length, events };
  });
}

export const formPeriodsJob: SchedulerJob = {
  name: "form_periods",
  cadence: "tick",
  async run({ now, dispatcher }) {
    const db = getDb();
    let sent = 0;
    let missed = 0;
    let seen = 0;
    const events: string[] = [];
    // Every active rule, a page at a time (keyset on id), so no rule past a
    // cap is skipped (Inspector Brad, #548).
    let after: string | null = null;
    for (;;) {
      const schedules: CoachFormSchedule[] = await db
        .select()
        .from(coachFormSchedules)
        .where(
          and(
            or(
              inArray(coachFormSchedules.trigger, ["weekly", "daily"]),
              // A once rule that one client gets weekly or daily (PER-129).
              and(
                eq(coachFormSchedules.trigger, "once"),
                inArray(
                  coachFormSchedules.id,
                  db
                    .select({ id: coachFormScheduleClients.scheduleId })
                    .from(coachFormScheduleClients)
                    .where(
                      inArray(
                        sql`${coachFormScheduleClients.override}->>'trigger'`,
                        ["weekly", "daily"],
                      ),
                    ),
                ),
              ),
            ),
            eq(coachFormSchedules.status, "active"),
            ...(after ? [gt(coachFormSchedules.id, after)] : []),
          ),
        )
        .orderBy(asc(coachFormSchedules.id))
        .limit(PAGE_SIZES.formRules);
      seen += schedules.length;
      for (const schedule of schedules) {
        const versionId = (
          await liveVersions(db, schedule.trainerId, [schedule.formId])
        ).get(schedule.formId);
        if (!versionId) continue;
        const targets = await scheduleTargets(db, schedule);
        const zones = await timeZones(targets.map((t) => t.clientId));
        for (const target of targets) {
          // Per client: their own cadence wins (PER-129, C10j).
          const trigger = effectiveTrigger(schedule, target.override);
          if (trigger !== "weekly" && trigger !== "daily") continue;
          const tz = safeTimeZone(zones.get(target.clientId));
          const periods = duePeriods(
            trigger,
            ruleFor(schedule, target.override),
            tz,
            now,
          ).filter(
            (p) =>
              p.at >= schedule.createdAt &&
              (target.activatedAt === null || p.at >= target.activatedAt),
          );
          for (const period of periods) {
            sent += (
              await insertRequests(db, [
                {
                  trainerId: target.trainerId,
                  clientId: target.clientId,
                  relationshipId: target.relationshipId,
                  formId: schedule.formId,
                  formVersionId: versionId,
                  scheduleId: schedule.id,
                  trigger,
                  periodKey: period.key,
                  sentAt: now,
                  dueAfterHours: effectiveDueAfterHours(
                    schedule,
                    target.override,
                  ),
                },
              ])
            ).length;
          }
          // Every tick, not only when the insert was new: if a run inserted the
          // period and then failed before this, the next run still marks the
          // earlier one (Inspector Brad, #548). Idempotent: a conditional
          // update and the event's dedupe key.
          const latest = periods[periods.length - 1];
          if (latest) {
            const ev = await missEarlier(
              schedule,
              trigger,
              target.relationshipId,
              target.clientId,
              latest.key,
              now,
            );
            missed += ev.missed;
            events.push(...ev.events);
          }
        }
      }
      if (schedules.length < PAGE_SIZES.formRules) break;
      after = schedules[schedules.length - 1]!.id;
    }
    await deliverCoachEvents(events, dispatcher);
    return { schedules: seen, sent, missed };
  },
};
