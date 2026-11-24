import { and, eq, inArray, isNotNull, isNull, ne } from "drizzle-orm";
import {
  coachFormRequests,
  coachFormScheduleClients,
  coachFormSchedules,
  coachForms,
  ptClientRelationships,
  type CoachFormSchedule,
} from "@persistence/db";
import type { DbOrTx } from "../../repositories/personalRecordsRepository";

/**
 * Request generators for coach forms (PER-116, design C D2): `on_join` (the
 * personal-code accept hook), `once` (when a schedule is created or a client
 * is added to it) and `on_end` (offboarding). Weekly and daily periods are
 * BE-C2's scheduler (PER-117).
 *
 * Every insert is `ON CONFLICT DO NOTHING` on
 * `(relationship_id, form_id, trigger, period_key)`, so retries, replays and
 * overlapping runs never duplicate a request. `insertRequests`,
 * `liveVersions` and `scheduleTargets` are shared with the weekly/daily
 * generator in `../scheduler/jobs/formPeriods.ts` (PER-117).
 *
 * Period keys carry the relationship's COACHING CYCLE (its `activated_at`): a
 * relationship that ends and is later revived is the same row, and without
 * the cycle the second "join" would collide with the first and never send.
 * `join:<cycle>`, `end:<cycle>`, `once:<scheduleId>:<cycle>`.
 */

export interface RelationshipRef {
  trainerId: string;
  clientId: string;
  relationshipId: string;
}

interface Cycle {
  key: string;
  activatedAt: Date | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
/** A missed request can still be answered (late) for this long. */
export const LATE_WINDOW_MS = 7 * DAY_MS;

function cycleOf(activatedAt: Date | null): Cycle {
  return {
    key: activatedAt ? `c${activatedAt.getTime()}` : "c0",
    activatedAt,
  };
}

export async function relationshipCycle(
  db: DbOrTx,
  relationshipId: string,
): Promise<Cycle> {
  const rows = await db
    .select({ activatedAt: ptClientRelationships.activatedAt })
    .from(ptClientRelationships)
    .where(eq(ptClientRelationships.id, relationshipId))
    .limit(1);
  return cycleOf(rows[0]?.activatedAt ?? null);
}

/**
 * Never before the cycle started, so coach reads that show only the current
 * cycle (`sent_at >= activated_at`) always include what it generated, even
 * if the API and database clocks disagree slightly.
 */
function sendTime(cycle: Cycle, now: Date): Date {
  return cycle.activatedAt && cycle.activatedAt > now ? cycle.activatedAt : now;
}

export const periodKeys = {
  join: (cycle: string) => `join:${cycle}`,
  end: (cycle: string) => `end:${cycle}`,
  once: (scheduleId: string, cycle: string) => `once:${scheduleId}:${cycle}`,
};

export interface ScheduleRule {
  dueAfterHours: number | null;
}

/** A schedule's rule for one client: the per-client override wins. */
export function effectiveDueAfterHours(
  schedule: Pick<CoachFormSchedule, "dueAfterHours">,
  override: Record<string, unknown> | null | undefined,
): number | null {
  // An explicit null is "no due date" for this client (PER-129).
  if (override && Object.hasOwn(override, "dueAfterHours")) {
    const fromOverride = override.dueAfterHours;
    return typeof fromOverride === "number" ? fromOverride : null;
  }
  return schedule.dueAfterHours ?? null;
}

/**
 * When this client gets the form (PER-129, C10j): the per-client override's
 * `trigger` wins (once, weekly or daily), else the rule's own.
 */
export function effectiveTrigger(
  schedule: Pick<CoachFormSchedule, "trigger">,
  override: Record<string, unknown> | null | undefined,
): string {
  const fromOverride = override?.trigger;
  return typeof fromOverride === "string" ? fromOverride : schedule.trigger;
}

export interface RequestDraft extends RelationshipRef {
  formId: string;
  formVersionId: string;
  scheduleId: string | null;
  trigger: "on_join" | "once" | "on_end" | "weekly" | "daily";
  periodKey: string;
  sentAt: Date;
  dueAfterHours: number | null;
}

export async function insertRequests(
  db: DbOrTx,
  drafts: RequestDraft[],
): Promise<string[]> {
  const ids: string[] = [];
  // One statement per row, in order: created_at is clock_timestamp(), so the
  // athlete sees them in the order they were generated (setup order).
  for (const d of drafts) {
    const inserted = await db
      .insert(coachFormRequests)
      .values({
        trainerId: d.trainerId,
        clientId: d.clientId,
        relationshipId: d.relationshipId,
        formId: d.formId,
        formVersionId: d.formVersionId,
        scheduleId: d.scheduleId,
        trigger: d.trigger,
        periodKey: d.periodKey,
        sentAt: d.sentAt,
        dueAt:
          d.dueAfterHours === null
            ? null
            : new Date(d.sentAt.getTime() + d.dueAfterHours * HOUR_MS),
        updatedAt: d.sentAt,
      })
      .onConflictDoNothing()
      .returning({ id: coachFormRequests.id });
    if (inserted[0]) ids.push(inserted[0].id);
  }
  return ids;
}

/** Current versions of the caller's live (unarchived) forms, by form id. */
export async function liveVersions(
  db: DbOrTx,
  trainerId: string,
  formIds: string[],
): Promise<Map<string, string>> {
  if (formIds.length === 0) return new Map();
  const rows = await db
    .select({ id: coachForms.id, versionId: coachForms.currentVersionId })
    .from(coachForms)
    .where(
      and(
        inArray(coachForms.id, formIds),
        eq(coachForms.trainerId, trainerId),
        isNull(coachForms.archivedAt),
        isNotNull(coachForms.currentVersionId),
      ),
    );
  return new Map(rows.map((r) => [r.id, r.versionId!]));
}

/**
 * One starter form from the client's set-up (the `starter_form` set-up
 * section). Returns the request id, new or already there; null when the form
 * has been archived since the set-up was written.
 */
export async function sendStarterForm(
  db: DbOrTx,
  ref: RelationshipRef,
  formId: string,
  dueAfterHours: number | null,
  now = new Date(),
): Promise<string | null> {
  const versions = await liveVersions(db, ref.trainerId, [formId]);
  const versionId = versions.get(formId);
  if (!versionId) return null;
  const cycle = await relationshipCycle(db, ref.relationshipId);
  const periodKey = periodKeys.join(cycle.key);
  await insertRequests(db, [
    {
      ...ref,
      formId,
      formVersionId: versionId,
      scheduleId: null,
      trigger: "on_join",
      periodKey,
      sentAt: sendTime(cycle, now),
      dueAfterHours,
    },
  ]);
  const row = await db
    .select({ id: coachFormRequests.id })
    .from(coachFormRequests)
    .where(
      and(
        eq(coachFormRequests.relationshipId, ref.relationshipId),
        eq(coachFormRequests.formId, formId),
        eq(coachFormRequests.trigger, "on_join"),
        eq(coachFormRequests.periodKey, periodKey),
      ),
    )
    .limit(1);
  return row[0]?.id ?? null;
}

/**
 * `on_join` for every active `all_clients` on_join schedule of this coach,
 * then the coach's active `all_clients` `once` rules for this new client.
 * Runs inside the accept transaction, AFTER the set-up items, so a form that
 * is both a starter form and an on_join rule is sent once, in set-up order.
 */
export async function generateOnJoin(
  db: DbOrTx,
  ref: RelationshipRef,
  now = new Date(),
): Promise<string[]> {
  const rules = await db
    .select()
    .from(coachFormSchedules)
    .where(
      and(
        eq(coachFormSchedules.trainerId, ref.trainerId),
        inArray(coachFormSchedules.trigger, ["on_join", "once"]),
        eq(coachFormSchedules.audience, "all_clients"),
        eq(coachFormSchedules.status, "active"),
      ),
    )
    .orderBy(coachFormSchedules.createdAt, coachFormSchedules.id);
  if (rules.length === 0) return [];
  const schedules = rules.filter((s) => s.trigger === "on_join");
  const versions = await liveVersions(
    db,
    ref.trainerId,
    schedules.map((s) => s.formId),
  );
  const cycle = await relationshipCycle(db, ref.relationshipId);
  const sentAt = sendTime(cycle, now);
  const ids = await insertRequests(
    db,
    schedules
      .filter((s) => versions.has(s.formId))
      .map((s) => ({
        ...ref,
        formId: s.formId,
        formVersionId: versions.get(s.formId)!,
        scheduleId: s.id,
        trigger: "on_join" as const,
        periodKey: periodKeys.join(cycle.key),
        sentAt,
        dueAfterHours: s.dueAfterHours,
      })),
  );
  // Joining is how a client is added to the coach's all-clients `once`
  // rules, so they go out now too (Inspector Brad, #543).
  for (const rule of rules.filter((s) => s.trigger === "once")) {
    ids.push(...(await generateOnce(db, rule, ref.relationshipId, now)));
  }
  return ids;
}

export interface Target extends RelationshipRef {
  activatedAt: Date | null;
  override: Record<string, unknown> | null;
}

/**
 * The clients a schedule reaches now. `selected`: its active targets.
 * `all_clients`: every active client of the coach, less anyone paused or
 * excluded on this schedule. Only active, human relationships.
 */
export async function scheduleTargets(
  db: DbOrTx,
  schedule: CoachFormSchedule,
  onlyRelationshipId?: string,
): Promise<Target[]> {
  const rels = await db
    .select({
      relationshipId: ptClientRelationships.id,
      clientId: ptClientRelationships.clientId,
      activatedAt: ptClientRelationships.activatedAt,
    })
    .from(ptClientRelationships)
    .where(
      and(
        eq(ptClientRelationships.trainerId, schedule.trainerId),
        eq(ptClientRelationships.status, "active"),
        eq(ptClientRelationships.isAiTrainer, false),
        ...(onlyRelationshipId
          ? [eq(ptClientRelationships.id, onlyRelationshipId)]
          : []),
      ),
    );
  const rows = await db
    .select()
    .from(coachFormScheduleClients)
    .where(eq(coachFormScheduleClients.scheduleId, schedule.id));
  const byRel = new Map(rows.map((r) => [r.relationshipId, r]));
  const targets: Target[] = [];
  for (const rel of rels) {
    const row = byRel.get(rel.relationshipId);
    const included =
      schedule.audience === "selected"
        ? row?.status === "active"
        : row === undefined || row.status === "active";
    if (!included) continue;
    targets.push({
      trainerId: schedule.trainerId,
      clientId: rel.clientId,
      relationshipId: rel.relationshipId,
      activatedAt: rel.activatedAt,
      override: row?.override ?? null,
    });
  }
  return targets;
}

/**
 * `once`: one request per current target, when the schedule is created (or
 * resumed) and when a client is added. Safe to call again at any time.
 */
export async function generateOnce(
  db: DbOrTx,
  schedule: CoachFormSchedule,
  onlyRelationshipId?: string,
  now = new Date(),
): Promise<string[]> {
  if (schedule.status !== "active") return [];
  // A weekly or daily rule can send once to one client (PER-129, C10j);
  // a join or end-of-coaching rule never does.
  if (!["once", "weekly", "daily"].includes(schedule.trigger)) return [];
  const targets = (
    await scheduleTargets(db, schedule, onlyRelationshipId)
  ).filter((t) => effectiveTrigger(schedule, t.override) === "once");
  if (targets.length === 0) return [];
  const versions = await liveVersions(db, schedule.trainerId, [
    schedule.formId,
  ]);
  const versionId = versions.get(schedule.formId);
  if (!versionId) return [];
  const drafts = targets.map((t) => {
    const cycle = cycleOf(t.activatedAt);
    return {
      trainerId: t.trainerId,
      clientId: t.clientId,
      relationshipId: t.relationshipId,
      formId: schedule.formId,
      formVersionId: versionId,
      scheduleId: schedule.id,
      trigger: "once" as const,
      periodKey: periodKeys.once(schedule.id, cycle.key),
      sentAt: sendTime(cycle, now),
      dueAfterHours: effectiveDueAfterHours(schedule, t.override),
    };
  });
  const ids = await insertRequests(db, drafts);
  // A client taken off the rule (excluded, or removed from `selected`) had
  // their request cancelled. Bringing them back sends it again: the same
  // key's cancelled row is revived as a fresh send (Inspector Brad, #543).
  // A completed request is never re-sent.
  for (const d of drafts) {
    const revived = await db
      .update(coachFormRequests)
      .set({
        status: "pending",
        formVersionId: d.formVersionId,
        sentAt: d.sentAt,
        dueAt:
          d.dueAfterHours === null
            ? null
            : new Date(d.sentAt.getTime() + d.dueAfterHours * HOUR_MS),
        completedAt: null,
        late: false,
        remindersSent: 0,
        updatedAt: d.sentAt,
      })
      .where(
        and(
          eq(coachFormRequests.relationshipId, d.relationshipId),
          eq(coachFormRequests.formId, d.formId),
          eq(coachFormRequests.trigger, "once"),
          eq(coachFormRequests.periodKey, d.periodKey),
          eq(coachFormRequests.status, "cancelled"),
        ),
      )
      .returning({ id: coachFormRequests.id });
    if (revived[0]) ids.push(revived[0].id);
  }
  return ids;
}

/**
 * Offboarding (inside `endCoachClientRelationship`'s transaction, after the
 * relationship row is ended):
 *
 *   1. generate the exit form(s): every active `on_end` schedule that reaches
 *      this client. That response stays visible to this coach (Brad, 20 Nov);
 *   2. cancel this coach's other pending requests for the relationship;
 *   3. stop this coach's schedule targets for it (the rows are removed, so
 *      a later rejoin starts from the rules as they are).
 *
 * Scoped to (this trainer, this relationship): another coach's forms for the
 * same athlete are never touched. Re-running it changes nothing.
 */
export async function closeFormsOnEnd(
  db: DbOrTx,
  ref: RelationshipRef,
  now = new Date(),
): Promise<{ exitRequestIds: string[]; cancelled: number }> {
  const cycle = await relationshipCycle(db, ref.relationshipId);
  const schedules = await db
    .select()
    .from(coachFormSchedules)
    .where(
      and(
        eq(coachFormSchedules.trainerId, ref.trainerId),
        eq(coachFormSchedules.trigger, "on_end"),
        eq(coachFormSchedules.status, "active"),
      ),
    )
    .orderBy(coachFormSchedules.createdAt, coachFormSchedules.id);
  const rows =
    schedules.length === 0
      ? []
      : await db
          .select()
          .from(coachFormScheduleClients)
          .where(
            and(
              eq(coachFormScheduleClients.relationshipId, ref.relationshipId),
              inArray(
                coachFormScheduleClients.scheduleId,
                schedules.map((s) => s.id),
              ),
            ),
          );
  const byScheduleId = new Map(rows.map((r) => [r.scheduleId, r]));
  const reaching = schedules.filter((s) => {
    const row = byScheduleId.get(s.id);
    return s.audience === "selected"
      ? row?.status === "active"
      : row === undefined || row.status === "active";
  });
  const versions = await liveVersions(
    db,
    ref.trainerId,
    reaching.map((s) => s.formId),
  );
  const sentAt = sendTime(cycle, now);
  const exitRequestIds = await insertRequests(
    db,
    reaching
      .filter((s) => versions.has(s.formId))
      .map((s) => ({
        ...ref,
        formId: s.formId,
        formVersionId: versions.get(s.formId)!,
        scheduleId: s.id,
        trigger: "on_end" as const,
        periodKey: periodKeys.end(cycle.key),
        sentAt,
        dueAfterHours: effectiveDueAfterHours(
          s,
          byScheduleId.get(s.id)?.override,
        ),
      })),
  );

  const cancelled = await db
    .update(coachFormRequests)
    .set({ status: "cancelled", updatedAt: now })
    .where(
      and(
        eq(coachFormRequests.relationshipId, ref.relationshipId),
        eq(coachFormRequests.trainerId, ref.trainerId),
        inArray(coachFormRequests.status, ["pending", "missed"]),
        ne(coachFormRequests.trigger, "on_end"),
      ),
    )
    .returning({ id: coachFormRequests.id });

  // Remove this relationship's targets. A rejoin revives the same
  // relationship row, so a stop recorded as `excluded` would silently carry
  // into the next coaching cycle (Inspector Brad, #543). Each cycle starts
  // from the coach's rules as they are.
  await db
    .delete(coachFormScheduleClients)
    .where(eq(coachFormScheduleClients.relationshipId, ref.relationshipId));

  return { exitRequestIds, cancelled: cancelled.length };
}
