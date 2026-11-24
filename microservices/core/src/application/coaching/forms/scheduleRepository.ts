import { and, desc, eq, inArray, ne, notInArray, sql } from "drizzle-orm";
import {
  coachFormRequests,
  coachFormScheduleClients,
  coachFormSchedules,
  ptClientRelationships,
  type CoachFormSchedule,
  type CoachFormScheduleClient,
} from "@persistence/db";
import { getDb } from "@persistence/db/client";
import type { DbOrTx } from "../../repositories/personalRecordsRepository";
import { CoachFormRepository } from "./formRepository";
import { generateOnce } from "./generators";

/**
 * Send rules (C10h) and per-client rules (C10j) for coach forms (PER-116,
 * design C D1–D3). Weekly and daily rules are stored here; BE-C2's scheduler
 * generates their periods. `once` sends as soon as a client is reached.
 */

export const TRIGGERS = [
  "on_join",
  "once",
  "weekly",
  "daily",
  "on_end",
] as const;
export type Trigger = (typeof TRIGGERS)[number];
export const AUDIENCES = ["all_clients", "selected"] as const;
export type Audience = (typeof AUDIENCES)[number];

export const MAX_REMINDERS = 5;
export const MAX_REMINDER_HOURS = 720;
export const MAX_DUE_HOURS = 2160;
export const MAX_SELECTED_CLIENTS = 500;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)(:([0-5]\d))?$/;

export interface Rule {
  weekday?: number | null;
  timeLocal?: string | null;
  dueAfterHours?: number | null;
  reminders?: { afterHours: number }[];
}

export type RuleCheck =
  | { ok: true; rule: Rule }
  | { ok: false; message: string };

/** HH:MM from Postgres `time` ("18:00:00") or a request ("18:00"). */
export function hhmm(value: string | null | undefined): string | null {
  return value ? value.slice(0, 5) : null;
}

/**
 * Check a rule (the schedule's own, or a per-client override) against its
 * trigger. Weekday is weekly-only; time is weekly/daily-only.
 */
export function checkRule(trigger: Trigger, raw: Rule): RuleCheck {
  const rule: Rule = {};
  if (raw.weekday !== undefined && raw.weekday !== null) {
    if (trigger !== "weekly") {
      return { ok: false, message: "weekday is for weekly rules only" };
    }
    if (!Number.isInteger(raw.weekday) || raw.weekday < 1 || raw.weekday > 7) {
      return { ok: false, message: "weekday must be 1 (Mon) to 7 (Sun)" };
    }
    rule.weekday = raw.weekday;
  }
  if (raw.timeLocal !== undefined && raw.timeLocal !== null) {
    if (trigger !== "weekly" && trigger !== "daily") {
      return { ok: false, message: "timeLocal is for weekly or daily rules" };
    }
    if (!TIME_PATTERN.test(raw.timeLocal)) {
      return { ok: false, message: "timeLocal must be HH:MM" };
    }
    rule.timeLocal = raw.timeLocal.slice(0, 5);
  }
  if (raw.dueAfterHours !== undefined && raw.dueAfterHours !== null) {
    if (
      !Number.isInteger(raw.dueAfterHours) ||
      raw.dueAfterHours < 1 ||
      raw.dueAfterHours > MAX_DUE_HOURS
    ) {
      return {
        ok: false,
        message: `dueAfterHours must be 1–${MAX_DUE_HOURS}`,
      };
    }
    rule.dueAfterHours = raw.dueAfterHours;
  }
  if (raw.reminders !== undefined) {
    if (raw.reminders.length > MAX_REMINDERS) {
      return { ok: false, message: `at most ${MAX_REMINDERS} reminders` };
    }
    const hours = new Set<number>();
    for (const r of raw.reminders) {
      if (
        !Number.isInteger(r.afterHours) ||
        r.afterHours < 1 ||
        r.afterHours > MAX_REMINDER_HOURS
      ) {
        return {
          ok: false,
          message: `reminder afterHours must be 1–${MAX_REMINDER_HOURS}`,
        };
      }
      hours.add(r.afterHours);
    }
    rule.reminders = [...hours]
      .sort((a, b) => a - b)
      .map((afterHours) => ({ afterHours }));
  }
  return { ok: true, rule };
}

/**
 * PER-129 (C10j): the triggers one client's rule can switch between. A
 * join or end-of-coaching form stays what it is.
 */
export const CLIENT_TRIGGERS = ["once", "weekly", "daily"] as const;
export type ClientTrigger = (typeof CLIENT_TRIGGERS)[number];

export function isClientTrigger(value: unknown): value is ClientTrigger {
  return (
    typeof value === "string" &&
    (CLIENT_TRIGGERS as readonly string[]).includes(value)
  );
}

export type OverrideCheck =
  | { ok: true; rule: Rule & { trigger?: ClientTrigger } }
  | { ok: false; message: string };

/**
 * A per-client override (C10j): the rule fields, plus `trigger` when this
 * client gets the form on a different cadence (once, weekly or daily). The
 * result must be complete for that cadence, with the rule's own day and
 * time filling any gap. `trigger` is only stored when it differs.
 */
export function checkOverride(
  schedule: {
    trigger: string;
    weekday: number | null;
    timeLocal: string | null;
    dueAfterHours?: number | null;
  },
  raw: Rule & { trigger?: unknown },
): OverrideCheck {
  let trigger = schedule.trigger as Trigger;
  let changed: ClientTrigger | null = null;
  if (raw.trigger !== undefined && raw.trigger !== null) {
    if (!isClientTrigger(raw.trigger)) {
      return { ok: false, message: "trigger must be once, weekly or daily" };
    }
    if (
      raw.trigger !== schedule.trigger &&
      !isClientTrigger(schedule.trigger)
    ) {
      return {
        ok: false,
        message: "a join or end-of-coaching form can't change when it's sent",
      };
    }
    trigger = raw.trigger;
    if (raw.trigger !== schedule.trigger) changed = raw.trigger;
  }
  const checked = checkRule(trigger, raw);
  if (!checked.ok) return checked;
  const missing = checkComplete(trigger, {
    ...checked.rule,
    weekday: checked.rule.weekday ?? schedule.weekday,
    timeLocal: checked.rule.timeLocal ?? hhmm(schedule.timeLocal),
  });
  if (missing) return { ok: false, message: missing };
  const rule: Rule & { trigger?: ClientTrigger } = changed
    ? { ...checked.rule, trigger: changed }
    : { ...checked.rule };
  // "No due date" for this client when the rule has one: an explicit null
  // is kept, so it wins over the rule's due time (Inspector Brad, #555).
  if (raw.dueAfterHours === null && schedule.dueAfterHours != null) {
    rule.dueAfterHours = null;
  }
  return { ok: true, rule };
}

/** A whole schedule's rule must be complete for its trigger. */
function checkComplete(trigger: Trigger, rule: Rule): string | null {
  if (trigger === "weekly" && (!rule.weekday || !rule.timeLocal)) {
    return "weekly rules need weekday and timeLocal";
  }
  if (trigger === "daily" && !rule.timeLocal) {
    return "daily rules need timeLocal";
  }
  return null;
}

export interface ScheduleClientDTO {
  clientId: string;
  relationshipId: string;
  status: string;
  override: Record<string, unknown> | null;
}

export interface ScheduleDTO {
  id: string;
  formId: string;
  trigger: string;
  audience: string;
  weekday: number | null;
  timeLocal: string | null;
  dueAfterHours: number | null;
  reminders: { afterHours: number }[];
  status: string;
  revision: number;
  clients: ScheduleClientDTO[];
  createdAt: string;
  updatedAt: string;
}

function clientDto(r: CoachFormScheduleClient): ScheduleClientDTO {
  return {
    clientId: r.clientId,
    relationshipId: r.relationshipId,
    status: r.status,
    override: r.override ?? null,
  };
}

export function scheduleDto(
  s: CoachFormSchedule,
  clients: CoachFormScheduleClient[],
): ScheduleDTO {
  return {
    id: s.id,
    formId: s.formId,
    trigger: s.trigger,
    audience: s.audience,
    weekday: s.weekday,
    timeLocal: hhmm(s.timeLocal),
    dueAfterHours: s.dueAfterHours,
    reminders: s.reminders,
    status: s.status,
    revision: s.revision,
    clients: clients.map(clientDto),
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

export type ScheduleError =
  | { status: 404; code: "form_not_found" | "schedule_not_found" }
  | { status: 409; code: "schedule_stopped" }
  | { status: 409; code: "revision_conflict"; current: ScheduleDTO }
  | { status: 422; code: "invalid_schedule"; message: string }
  | { status: 422; code: "not_your_client"; clientIds: string[] };

export interface CreateScheduleInput extends Rule {
  formId: string;
  trigger: Trigger;
  audience: Audience;
  clientIds?: string[];
  status?: "active" | "paused";
  clientRequestId: string | null;
}

export interface PatchScheduleInput extends Rule {
  audience?: Audience;
  clientIds?: string[];
  status?: "active" | "paused" | "stopped";
  expectedRevision?: number;
}

const invalid = (message: string): ScheduleError => ({
  status: 422,
  code: "invalid_schedule",
  message,
});

/** The caller's active (human) relationships for these athletes. */
async function activeRelationships(
  db: DbOrTx,
  trainerId: string,
  clientIds: string[],
): Promise<Map<string, string>> {
  if (clientIds.length === 0) return new Map();
  const rows = await db
    .select({
      id: ptClientRelationships.id,
      clientId: ptClientRelationships.clientId,
    })
    .from(ptClientRelationships)
    .where(
      and(
        eq(ptClientRelationships.trainerId, trainerId),
        inArray(ptClientRelationships.clientId, clientIds),
        eq(ptClientRelationships.status, "active"),
        eq(ptClientRelationships.isAiTrainer, false),
      ),
    );
  return new Map(rows.map((r) => [r.clientId, r.id]));
}

/** Cancel pending (or missed) requests a schedule made, optionally for one relationship. */
export async function cancelScheduleRequests(
  db: DbOrTx,
  scheduleId: string,
  relationshipIds?: string[],
): Promise<number> {
  if (relationshipIds && relationshipIds.length === 0) return 0;
  const rows = await db
    .update(coachFormRequests)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(
      and(
        eq(coachFormRequests.scheduleId, scheduleId),
        inArray(coachFormRequests.status, ["pending", "missed"]),
        // Never an exit form: it was sent to an ended relationship, and
        // stopping or narrowing the rule doesn't take it back (Inspector Brad).
        ne(coachFormRequests.trigger, "on_end"),
        ...(relationshipIds
          ? [inArray(coachFormRequests.relationshipId, relationshipIds)]
          : []),
      ),
    )
    .returning({ id: coachFormRequests.id });
  return rows.length;
}

export class CoachFormScheduleRepository {
  private readonly db: DbOrTx;

  constructor(db: DbOrTx = getDb()) {
    this.db = db;
  }

  private async clientsOf(
    scheduleIds: string[],
    db: DbOrTx = this.db,
  ): Promise<Map<string, CoachFormScheduleClient[]>> {
    const map = new Map<string, CoachFormScheduleClient[]>();
    if (scheduleIds.length === 0) return map;
    const rows = await db
      .select()
      .from(coachFormScheduleClients)
      .where(inArray(coachFormScheduleClients.scheduleId, scheduleIds))
      .orderBy(coachFormScheduleClients.createdAt);
    for (const r of rows) {
      map.set(r.scheduleId, [...(map.get(r.scheduleId) ?? []), r]);
    }
    return map;
  }

  async list(trainerId: string): Promise<ScheduleDTO[]> {
    const rows = await this.db
      .select()
      .from(coachFormSchedules)
      .where(eq(coachFormSchedules.trainerId, trainerId))
      .orderBy(desc(coachFormSchedules.updatedAt), coachFormSchedules.id);
    const clients = await this.clientsOf(rows.map((r) => r.id));
    return rows.map((r) => scheduleDto(r, clients.get(r.id) ?? []));
  }

  async get(
    trainerId: string,
    id: string,
    db: DbOrTx = this.db,
  ): Promise<ScheduleDTO | null> {
    const rows = await db
      .select()
      .from(coachFormSchedules)
      .where(
        and(
          eq(coachFormSchedules.id, id),
          eq(coachFormSchedules.trainerId, trainerId),
        ),
      )
      .limit(1);
    if (!rows[0]) return null;
    const clients = await this.clientsOf([id], db);
    return scheduleDto(rows[0], clients.get(id) ?? []);
  }

  async create(
    trainerId: string,
    input: CreateScheduleInput,
  ): Promise<
    { ok: true; schedule: ScheduleDTO; replay: boolean } | ScheduleError
  > {
    const checked = checkRule(input.trigger, input);
    if (!checked.ok) return invalid(checked.message);
    const missing = checkComplete(input.trigger, checked.rule);
    if (missing) return invalid(missing);
    if (input.trigger === "on_join" && input.audience !== "all_clients") {
      return invalid(
        "on_join rules go to every new client; choose a client's starter forms in their set-up",
      );
    }
    const clientIds = [...new Set(input.clientIds ?? [])];
    if (input.audience === "all_clients" && clientIds.length > 0) {
      return invalid("clientIds are only for the selected audience");
    }
    if (
      input.audience === "selected" &&
      (clientIds.length === 0 || clientIds.length > MAX_SELECTED_CLIENTS)
    ) {
      return invalid(`selected needs 1–${MAX_SELECTED_CLIENTS} clientIds`);
    }

    return getDb().transaction(async (tx) => {
      if (input.clientRequestId) {
        const existing = await tx
          .select({ id: coachFormSchedules.id })
          .from(coachFormSchedules)
          .where(
            and(
              eq(coachFormSchedules.trainerId, trainerId),
              eq(coachFormSchedules.clientRequestId, input.clientRequestId),
            ),
          )
          .limit(1);
        if (existing[0]) {
          return {
            ok: true as const,
            schedule: (await this.get(trainerId, existing[0].id, tx))!,
            replay: true,
          };
        }
      }
      const form = await new CoachFormRepository(tx).ownLive(
        trainerId,
        input.formId,
      );
      if (!form)
        return { status: 404 as const, code: "form_not_found" as const };
      const rels = await activeRelationships(tx, trainerId, clientIds);
      const strangers = clientIds.filter((id) => !rels.has(id));
      if (strangers.length > 0) {
        return {
          status: 422 as const,
          code: "not_your_client" as const,
          clientIds: strangers,
        };
      }
      const inserted = await tx
        .insert(coachFormSchedules)
        .values({
          trainerId,
          formId: input.formId,
          trigger: input.trigger,
          audience: input.audience,
          weekday: checked.rule.weekday ?? null,
          timeLocal: checked.rule.timeLocal ?? null,
          dueAfterHours: checked.rule.dueAfterHours ?? null,
          reminders: checked.rule.reminders ?? [],
          status: input.status ?? "active",
          clientRequestId: input.clientRequestId,
        })
        .returning();
      const schedule = inserted[0]!;
      if (clientIds.length > 0) {
        await tx.insert(coachFormScheduleClients).values(
          clientIds.map((clientId) => ({
            scheduleId: schedule.id,
            clientId,
            relationshipId: rels.get(clientId)!,
          })),
        );
      }
      await generateOnce(tx, schedule);
      return {
        ok: true as const,
        schedule: (await this.get(trainerId, schedule.id, tx))!,
        replay: false,
      };
    });
  }

  async patch(
    trainerId: string,
    id: string,
    input: PatchScheduleInput,
  ): Promise<{ ok: true; schedule: ScheduleDTO } | ScheduleError> {
    return getDb().transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(coachFormSchedules)
        .where(
          and(
            eq(coachFormSchedules.id, id),
            eq(coachFormSchedules.trainerId, trainerId),
          ),
        )
        .limit(1)
        .for("update");
      const current = rows[0];
      if (!current) {
        return { status: 404 as const, code: "schedule_not_found" as const };
      }
      if (
        input.expectedRevision !== undefined &&
        input.expectedRevision !== current.revision
      ) {
        return {
          status: 409 as const,
          code: "revision_conflict" as const,
          current: (await this.get(trainerId, id, tx))!,
        };
      }
      if (current.status === "stopped") {
        return { status: 409 as const, code: "schedule_stopped" as const };
      }
      const trigger = current.trigger as Trigger;
      const checked = checkRule(trigger, input);
      if (!checked.ok) return invalid(checked.message);
      const merged: Rule = {
        weekday:
          input.weekday !== undefined
            ? (checked.rule.weekday ?? null)
            : current.weekday,
        timeLocal:
          input.timeLocal !== undefined
            ? (checked.rule.timeLocal ?? null)
            : hhmm(current.timeLocal),
        dueAfterHours:
          input.dueAfterHours !== undefined
            ? (checked.rule.dueAfterHours ?? null)
            : current.dueAfterHours,
        reminders: checked.rule.reminders ?? current.reminders,
      };
      const missing = checkComplete(trigger, merged);
      if (missing) return invalid(missing);
      const audience = input.audience ?? (current.audience as Audience);
      if (trigger === "on_join" && audience !== "all_clients") {
        return invalid("on_join rules go to every new client");
      }
      if (audience === "all_clients" && (input.clientIds?.length ?? 0) > 0) {
        return invalid("clientIds are only for the selected audience");
      }
      const clientIds =
        input.clientIds !== undefined
          ? [...new Set(input.clientIds)]
          : undefined;
      if (
        audience === "selected" &&
        (clientIds !== undefined || current.audience !== "selected") &&
        (clientIds === undefined ||
          clientIds.length === 0 ||
          clientIds.length > MAX_SELECTED_CLIENTS)
      ) {
        // Narrowing an all-clients rule needs the list it narrows to.
        return invalid(`selected needs 1–${MAX_SELECTED_CLIENTS} clientIds`);
      }

      if (clientIds !== undefined && audience === "selected") {
        const rels = await activeRelationships(tx, trainerId, clientIds);
        const strangers = clientIds.filter((c) => !rels.has(c));
        if (strangers.length > 0) {
          return {
            status: 422 as const,
            code: "not_your_client" as const,
            clientIds: strangers,
          };
        }
        const existing = await tx
          .select()
          .from(coachFormScheduleClients)
          .where(eq(coachFormScheduleClients.scheduleId, id));
        const now = new Date();
        const keep = new Set(rels.values());
        const removed = existing
          .filter((r) => !keep.has(r.relationshipId) && r.status !== "excluded")
          .map((r) => r.relationshipId);
        if (removed.length > 0) {
          await tx
            .update(coachFormScheduleClients)
            .set({ status: "excluded", updatedAt: now })
            .where(
              and(
                eq(coachFormScheduleClients.scheduleId, id),
                inArray(coachFormScheduleClients.relationshipId, removed),
              ),
            );
        }
        // Anyone the rule no longer reaches loses their open request, including
        // clients an all-clients rule reached without a target row (Inspector
        // Brad, #543).
        await tx
          .update(coachFormRequests)
          .set({ status: "cancelled", updatedAt: now })
          .where(
            and(
              eq(coachFormRequests.scheduleId, id),
              inArray(coachFormRequests.status, ["pending", "missed"]),
              notInArray(coachFormRequests.relationshipId, [...keep]),
              // Exit forms belong to relationships that have already ended;
              // the rule's audience no longer governs them (Inspector Brad).
              ne(coachFormRequests.trigger, "on_end"),
            ),
          );
        for (const [clientId, relationshipId] of rels) {
          await tx
            .insert(coachFormScheduleClients)
            .values({ scheduleId: id, clientId, relationshipId })
            .onConflictDoUpdate({
              target: [
                coachFormScheduleClients.scheduleId,
                coachFormScheduleClients.relationshipId,
              ],
              // Re-adding an excluded client brings them back; a paused one
              // stays paused (that's the per-client setting).
              set: {
                status: sql`case when ${coachFormScheduleClients.status} = 'excluded' then 'active' else ${coachFormScheduleClients.status} end`,
                updatedAt: now,
              },
            });
        }
      }

      const status = input.status ?? current.status;
      const updated = await tx
        .update(coachFormSchedules)
        .set({
          audience,
          weekday: merged.weekday ?? null,
          timeLocal: merged.timeLocal ?? null,
          dueAfterHours: merged.dueAfterHours ?? null,
          reminders: merged.reminders ?? [],
          status,
          revision: sql`${coachFormSchedules.revision} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(coachFormSchedules.id, id))
        .returning();
      // Stop also cancels pending requests; pause only stops new ones.
      if (status === "stopped") await cancelScheduleRequests(tx, id);
      await generateOnce(tx, updated[0]!);
      return {
        ok: true as const,
        schedule: (await this.get(trainerId, id, tx))!,
      };
    });
  }

  /** DELETE = stop. Idempotent; false when it isn't the caller's. */
  async stop(trainerId: string, id: string): Promise<boolean> {
    return getDb().transaction(async (tx) => {
      const rows = await tx
        .update(coachFormSchedules)
        .set({
          status: "stopped",
          revision: sql`${coachFormSchedules.revision} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(coachFormSchedules.id, id),
            eq(coachFormSchedules.trainerId, trainerId),
            ne(coachFormSchedules.status, "stopped"),
          ),
        )
        .returning({ id: coachFormSchedules.id });
      if (rows[0]) {
        await cancelScheduleRequests(tx, id);
        return true;
      }
      const exists = await tx
        .select({ id: coachFormSchedules.id })
        .from(coachFormSchedules)
        .where(
          and(
            eq(coachFormSchedules.id, id),
            eq(coachFormSchedules.trainerId, trainerId),
          ),
        )
        .limit(1);
      return exists.length > 0;
    });
  }
}
