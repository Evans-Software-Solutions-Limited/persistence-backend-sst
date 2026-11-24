import { and, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import {
  coachFormRequests,
  coachFormScheduleClients,
  coachFormSchedules,
  coachForms,
  profiles,
  ptClientRelationships,
} from "@persistence/db";
import { getDb } from "@persistence/db/client";
import { effectiveStatus } from "./requestsRepository";

/**
 * PER-129 (C10a, C10g): how each form in the coach's library is doing right
 * now, across their active clients.
 *
 * "Right now" is each client's LATEST request for the form in their current
 * coaching cycle (a weekly form: this week's; a once or join form: the one
 * they were sent). That gives "8 of 11 this week", "13 of 14 done" and the
 * Outstanding list with when the last reminder went. Cancelled requests and
 * ended relationships are left out.
 *
 * Only the caller's rows: every query filters by `trainer_id = caller`.
 */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
export const ON_TIME_WINDOW_DAYS = 28;

export type ClientFormStatus = "done" | "pending" | "missed";

export interface FormStatsClientDTO {
  clientId: string;
  name: string | null;
  requestId: string;
  status: ClientFormStatus;
  late: boolean;
  sentAt: string;
  dueAt: string | null;
  completedAt: string | null;
  remindersSent: number;
  lastReminderAt: string | null;
}

export interface FormStatsDTO {
  formId: string;
  /** Clients with a current request for this form. */
  reached: number;
  done: number;
  outstanding: number;
  /** Outstanding first (missed, then pending), then done, newest first. */
  clients: FormStatsClientDTO[];
}

export interface FormStatsTotalsDTO {
  /** Live (unarchived) forms in the library. */
  forms: number;
  /** Forms with a live weekly or daily rule. */
  repeating: number;
  /** Requests still pending or missed, across every form. */
  outstanding: number;
  /** Share of requests due in the last 4 weeks that were done on time. */
  onTimeRate: number | null;
  /** How many due requests the rate is over. */
  onTimeSample: number;
}

const ORDER: Record<ClientFormStatus, number> = {
  missed: 0,
  pending: 1,
  done: 2,
};

function reminderHours(
  schedule: { reminders: { afterHours: number }[] } | null,
  override: Record<string, unknown> | null | undefined,
): number[] {
  const fromOverride = override?.reminders;
  const list = Array.isArray(fromOverride)
    ? (fromOverride as { afterHours?: unknown }[])
    : (schedule?.reminders ?? []);
  return list
    .map((r) => r.afterHours)
    .filter((h): h is number => typeof h === "number")
    .sort((a, b) => a - b);
}

export async function formStats(
  trainerId: string,
  now = new Date(),
): Promise<{ forms: FormStatsDTO[]; totals: FormStatsTotalsDTO }> {
  const db = getDb();
  const liveForms = await db
    .select({ id: coachForms.id })
    .from(coachForms)
    .where(
      and(eq(coachForms.trainerId, trainerId), isNull(coachForms.archivedAt)),
    );
  const schedules = await db
    .select()
    .from(coachFormSchedules)
    .where(
      and(
        eq(coachFormSchedules.trainerId, trainerId),
        ne(coachFormSchedules.status, "stopped"),
      ),
    );
  const repeating = new Set(
    schedules
      .filter((s) => s.trigger === "weekly" || s.trigger === "daily")
      .map((s) => s.formId),
  );

  const rels = await db
    .select({
      id: ptClientRelationships.id,
      clientId: ptClientRelationships.clientId,
      activatedAt: ptClientRelationships.activatedAt,
      name: profiles.fullName,
    })
    .from(ptClientRelationships)
    .leftJoin(profiles, eq(profiles.id, ptClientRelationships.clientId))
    .where(
      and(
        eq(ptClientRelationships.trainerId, trainerId),
        eq(ptClientRelationships.status, "active"),
        eq(ptClientRelationships.isAiTrainer, false),
      ),
    );
  const relById = new Map(rels.map((r) => [r.id, r]));
  const requests =
    rels.length === 0
      ? []
      : await db
          .select()
          .from(coachFormRequests)
          .where(
            and(
              eq(coachFormRequests.trainerId, trainerId),
              inArray(
                coachFormRequests.relationshipId,
                rels.map((r) => r.id),
              ),
              ne(coachFormRequests.status, "cancelled"),
            ),
          )
          .orderBy(desc(coachFormRequests.sentAt), desc(coachFormRequests.id));
  const scheduleIds = [
    ...new Set(requests.map((r) => r.scheduleId).filter(Boolean)),
  ] as string[];
  const overrides =
    scheduleIds.length === 0
      ? []
      : await db
          .select()
          .from(coachFormScheduleClients)
          .where(inArray(coachFormScheduleClients.scheduleId, scheduleIds));
  const overrideOf = new Map(
    overrides.map((o) => [`${o.scheduleId}:${o.relationshipId}`, o.override]),
  );
  const scheduleById = new Map(schedules.map((s) => [s.id, s]));

  // Current cycle only: a client who left and came back starts again.
  const current = requests.filter((r) => {
    const rel = relById.get(r.relationshipId);
    return !rel?.activatedAt || r.sentAt >= rel.activatedAt;
  });

  const byForm = new Map<string, FormStatsDTO>();
  const seen = new Set<string>();
  for (const r of current) {
    const key = `${r.formId}:${r.relationshipId}`;
    if (seen.has(key)) continue; // newest first: the first one is the latest
    seen.add(key);
    const rel = relById.get(r.relationshipId)!;
    const effective = effectiveStatus(r, now);
    const status: ClientFormStatus =
      effective === "completed"
        ? "done"
        : effective === "missed"
          ? "missed"
          : "pending";
    const hours = reminderHours(
      r.scheduleId ? (scheduleById.get(r.scheduleId) ?? null) : null,
      r.scheduleId
        ? overrideOf.get(`${r.scheduleId}:${r.relationshipId}`)
        : null,
    );
    const lastHours =
      r.remindersSent > 0
        ? hours[Math.min(r.remindersSent, hours.length) - 1]
        : undefined;
    const stats = byForm.get(r.formId) ?? {
      formId: r.formId,
      reached: 0,
      done: 0,
      outstanding: 0,
      clients: [],
    };
    stats.reached += 1;
    if (status === "done") stats.done += 1;
    else stats.outstanding += 1;
    stats.clients.push({
      clientId: rel.clientId,
      name: rel.name ?? null,
      requestId: r.id,
      status,
      late: r.late,
      sentAt: r.sentAt.toISOString(),
      dueAt: r.dueAt ? r.dueAt.toISOString() : null,
      completedAt: r.completedAt ? r.completedAt.toISOString() : null,
      remindersSent: r.remindersSent,
      lastReminderAt:
        lastHours === undefined
          ? null
          : new Date(r.sentAt.getTime() + lastHours * HOUR_MS).toISOString(),
    });
    byForm.set(r.formId, stats);
  }
  for (const stats of byForm.values()) {
    stats.clients.sort(
      (a, b) =>
        ORDER[a.status] - ORDER[b.status] || b.sentAt.localeCompare(a.sentAt),
    );
  }

  // On time: requests due in the last 4 weeks (and already due).
  const windowStart = new Date(now.getTime() - ON_TIME_WINDOW_DAYS * DAY_MS);
  let due = 0;
  let onTime = 0;
  for (const r of current) {
    if (!r.dueAt || r.dueAt < windowStart || r.dueAt > now) continue;
    due += 1;
    if (r.completedAt && !r.late && r.completedAt <= r.dueAt) onTime += 1;
  }

  const forms = [...byForm.values()];
  return {
    forms,
    totals: {
      forms: liveForms.length,
      repeating: liveForms.filter((f) => repeating.has(f.id)).length,
      outstanding: forms.reduce((n, f) => n + f.outstanding, 0),
      onTimeRate: due === 0 ? null : onTime / due,
      onTimeSample: due,
    },
  };
}
