import { and, asc, eq, inArray, isNull, ne } from "drizzle-orm";
import {
  coachFormRequests,
  coachFormScheduleClients,
  coachFormSchedules,
  coachForms,
  ptClientRelationships,
} from "@persistence/db";
import type { DbOrTx } from "../../repositories/personalRecordsRepository";
import type { SetupItemInput, SetupSectionHandler } from "../setupSections";
import {
  generateOnce,
  periodKeys,
  relationshipCycle,
  sendStarterForm,
} from "./generators";
import { checkRule, MAX_DUE_HOURS, type Trigger } from "./scheduleRepository";

/**
 * The forms sections of an invited client's set-up (PER-116, design A D4 +
 * design C D2), plugged into `HANDLERS` in `../setupSections.ts`:
 *
 *   starter_form   — refId = one of the coach's forms. On accept it is sent
 *                    as an `on_join` request (de-duplicated with the coach's
 *                    all-clients on_join rules). config: {dueAfterHours?}
 *   repeating_form — refId = one of the coach's send rules (once, weekly or
 *                    daily). On accept the client is added to it, with an
 *                    optional per-client rule. config: {override?}
 */

export const MAX_FORM_SETUP_ITEMS = 20;

async function liveForm(db: DbOrTx, trainerId: string, formId: string) {
  const rows = await db
    .select({ id: coachForms.id, title: coachForms.title })
    .from(coachForms)
    .where(
      and(
        eq(coachForms.id, formId),
        eq(coachForms.trainerId, trainerId),
        isNull(coachForms.archivedAt),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

async function titles(db: DbOrTx, formIds: string[]) {
  if (formIds.length === 0) return new Map<string, string>();
  const rows = await db
    .select({ id: coachForms.id, title: coachForms.title })
    .from(coachForms)
    .where(inArray(coachForms.id, formIds));
  return new Map(rows.map((r) => [r.id, r.title]));
}

/** The caller's active relationship with one client (copy-from). */
async function activeRelationshipId(
  db: DbOrTx,
  trainerId: string,
  clientId: string,
): Promise<string | null> {
  const rows = await db
    .select({ id: ptClientRelationships.id })
    .from(ptClientRelationships)
    .where(
      and(
        eq(ptClientRelationships.trainerId, trainerId),
        eq(ptClientRelationships.clientId, clientId),
        eq(ptClientRelationships.status, "active"),
      ),
    )
    .limit(1);
  return rows[0]?.id ?? null;
}

export const starterFormHandler: SetupSectionHandler = {
  maxItems: MAX_FORM_SETUP_ITEMS,
  async validate(db, trainerId, item) {
    if (!item.refId) return { ok: false, message: "refId must be a form id" };
    if (!(await liveForm(db, trainerId, item.refId))) {
      return { ok: false, message: "refId is not one of your forms" };
    }
    const due = item.config.dueAfterHours;
    if (
      due !== undefined &&
      due !== null &&
      (!Number.isInteger(due) ||
        (due as number) < 1 ||
        (due as number) > MAX_DUE_HOURS)
    ) {
      return {
        ok: false,
        message: `config.dueAfterHours must be 1–${MAX_DUE_HOURS}`,
      };
    }
    return {
      ok: true,
      item: {
        refId: item.refId,
        config: typeof due === "number" ? { dueAfterHours: due } : {},
        sortOrder: item.sortOrder,
      },
    };
  },
  async materialise(ctx, item) {
    const requestId = await sendStarterForm(
      ctx.tx,
      {
        trainerId: ctx.trainerId,
        clientId: ctx.clientId,
        relationshipId: ctx.relationshipId,
      },
      item.refId!,
      typeof item.config.dueAfterHours === "number"
        ? item.config.dueAfterHours
        : null,
    );
    return { refId: requestId };
  },
  async copyFromClient(db, trainerId, clientId) {
    const relationshipId = await activeRelationshipId(db, trainerId, clientId);
    if (!relationshipId) return [];
    const cycle = await relationshipCycle(db, relationshipId);
    const rows = await db
      .select({ formId: coachFormRequests.formId })
      .from(coachFormRequests)
      .innerJoin(coachForms, eq(coachForms.id, coachFormRequests.formId))
      .where(
        and(
          eq(coachFormRequests.relationshipId, relationshipId),
          eq(coachFormRequests.trainerId, trainerId),
          eq(coachFormRequests.trigger, "on_join"),
          // Real starter sends only: not forms from all-clients on_join rules
          // (schedule_id set), and only this coaching cycle (Inspector Brad, #543).
          isNull(coachFormRequests.scheduleId),
          eq(coachFormRequests.periodKey, periodKeys.join(cycle.key)),
          isNull(coachForms.archivedAt),
        ),
      )
      .orderBy(asc(coachFormRequests.createdAt));
    const seen = new Set<string>();
    const items: SetupItemInput[] = [];
    for (const r of rows) {
      if (seen.has(r.formId)) continue;
      seen.add(r.formId);
      items.push({ refId: r.formId, config: {}, sortOrder: items.length });
    }
    return items;
  },
  async preview(db, items) {
    const map = await titles(
      db,
      items.map((i) => i.refId).filter((id): id is string => !!id),
    );
    return {
      forms: items
        .map((i) => map.get(i.refId ?? ""))
        .filter((t): t is string => t !== undefined)
        .map((title) => ({ title })),
    };
  },
};

const REPEATING_TRIGGERS: ReadonlySet<string> = new Set([
  "once",
  "weekly",
  "daily",
]);

async function liveSchedule(db: DbOrTx, trainerId: string, scheduleId: string) {
  const rows = await db
    .select()
    .from(coachFormSchedules)
    .innerJoin(coachForms, eq(coachForms.id, coachFormSchedules.formId))
    .where(
      and(
        eq(coachFormSchedules.id, scheduleId),
        eq(coachFormSchedules.trainerId, trainerId),
        ne(coachFormSchedules.status, "stopped"),
        isNull(coachForms.archivedAt),
      ),
    )
    .limit(1);
  return rows[0]?.coach_form_schedules ?? null;
}

export const repeatingFormHandler: SetupSectionHandler = {
  maxItems: MAX_FORM_SETUP_ITEMS,
  async validate(db, trainerId, item) {
    if (!item.refId) {
      return { ok: false, message: "refId must be a send rule id" };
    }
    const schedule = await liveSchedule(db, trainerId, item.refId);
    if (!schedule || !REPEATING_TRIGGERS.has(schedule.trigger)) {
      return {
        ok: false,
        message: "refId is not one of your once, weekly or daily send rules",
      };
    }
    const raw = item.config.override;
    let override: Record<string, unknown> | undefined;
    if (raw !== undefined && raw !== null) {
      if (typeof raw !== "object" || Array.isArray(raw)) {
        return { ok: false, message: "config.override must be an object" };
      }
      const checked = checkRule(schedule.trigger as Trigger, raw);
      if (!checked.ok) {
        return { ok: false, message: `config.override: ${checked.message}` };
      }
      override = checked.rule as Record<string, unknown>;
    }
    return {
      ok: true,
      item: {
        refId: item.refId,
        config: override ? { override } : {},
        sortOrder: item.sortOrder,
      },
    };
  },
  async materialise(ctx, item) {
    const schedule = await liveSchedule(ctx.tx, ctx.trainerId, item.refId!);
    if (!schedule) return { refId: null };
    const override =
      (item.config.override as Record<string, unknown> | undefined) ?? null;
    await ctx.tx
      .insert(coachFormScheduleClients)
      .values({
        scheduleId: schedule.id,
        clientId: ctx.clientId,
        relationshipId: ctx.relationshipId,
        status: "active",
        override,
      })
      .onConflictDoUpdate({
        target: [
          coachFormScheduleClients.scheduleId,
          coachFormScheduleClients.relationshipId,
        ],
        set: { status: "active", override, updatedAt: new Date() },
      });
    await generateOnce(ctx.tx, schedule, ctx.relationshipId);
    return { refId: schedule.id };
  },
  async copyFromClient(db, trainerId, clientId) {
    const relationshipId = await activeRelationshipId(db, trainerId, clientId);
    if (!relationshipId) return [];
    const rows = await db
      .select({ target: coachFormScheduleClients })
      .from(coachFormScheduleClients)
      .innerJoin(
        coachFormSchedules,
        eq(coachFormSchedules.id, coachFormScheduleClients.scheduleId),
      )
      .where(
        and(
          eq(coachFormScheduleClients.relationshipId, relationshipId),
          eq(coachFormScheduleClients.status, "active"),
          eq(coachFormSchedules.trainerId, trainerId),
          eq(coachFormSchedules.audience, "selected"),
          ne(coachFormSchedules.status, "stopped"),
          inArray(coachFormSchedules.trigger, [...REPEATING_TRIGGERS]),
        ),
      )
      .orderBy(asc(coachFormScheduleClients.createdAt));
    return rows.map((r, i) => ({
      refId: r.target.scheduleId,
      config: r.target.override ? { override: r.target.override } : {},
      sortOrder: i,
    }));
  },
  async preview(db, items) {
    const ids = items.map((i) => i.refId).filter((id): id is string => !!id);
    if (ids.length === 0) return { forms: [] };
    const rows = await db
      .select({ id: coachFormSchedules.id, formId: coachFormSchedules.formId })
      .from(coachFormSchedules)
      .where(inArray(coachFormSchedules.id, ids));
    const formOf = new Map(rows.map((r) => [r.id, r.formId]));
    const map = await titles(db, [...new Set(rows.map((r) => r.formId))]);
    return {
      forms: ids
        .map((id) => map.get(formOf.get(id) ?? ""))
        .filter((t): t is string => t !== undefined)
        .map((title) => ({ title })),
    };
  },
};
