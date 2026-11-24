import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  inArray,
  lt,
  ne,
  or,
  sql,
} from "drizzle-orm";
import {
  coachFormRequests,
  coachFormResponses,
  coachFormScheduleClients,
  coachFormSchedules,
  coachFormVersions,
  coachForms,
  profiles,
  ptClientRelationships,
  type CoachFormRequest,
  type CoachFormResponse,
} from "@persistence/db";
import { getDb } from "@persistence/db/client";
import type { DbOrTx } from "../../repositories/personalRecordsRepository";
import { stripNul } from "../../shared/stripNul";
import { listAsOf } from "./formRepository";
import { LATE_WINDOW_MS, generateOnce } from "./generators";
import { deliverCoachEvents, recordCoachEvent } from "../events/coachEvents";
import { validateAnswers, type FieldError, type Question } from "./questions";
import {
  attachPhotoAnswers,
  finalisePhotoAnswers,
  lockPhotoAnswers,
} from "../../media/privateMediaRepository";
import {
  cancelScheduleRequests,
  checkRule,
  hhmm,
  type Trigger,
} from "./scheduleRepository";

/**
 * Form requests and responses (PER-116, design C D2/D3): the athlete's due
 * forms and submitting them, and the coach's Check-ins tab, response history
 * and review.
 */

// ─── Status ──────────────────────────────────────────────────────────────────

/**
 * What a request is NOW. BE-C2's scheduler stores `missed`; until it runs, a
 * pending request past its due date already counts as missed. Missed requests
 * can be answered (late) for 7 days after they were due.
 */
export function effectiveStatus(
  r: Pick<CoachFormRequest, "status" | "dueAt">,
  now = new Date(),
): CoachFormRequest["status"] {
  if (r.status === "pending" && r.dueAt && r.dueAt < now) return "missed";
  return r.status;
}

export function closesAt(r: Pick<CoachFormRequest, "dueAt">): Date | null {
  return r.dueAt ? new Date(r.dueAt.getTime() + LATE_WINDOW_MS) : null;
}

function answerable(
  r: Pick<CoachFormRequest, "status" | "dueAt">,
  now: Date,
): boolean {
  const status = effectiveStatus(r, now);
  if (status === "pending") return true;
  if (status !== "missed") return false;
  const closes = closesAt(r);
  return closes === null || now <= closes;
}

// ─── Athlete ─────────────────────────────────────────────────────────────────

export interface AthleteRequestDTO {
  id: string;
  formId: string;
  title: string;
  description: string | null;
  coach: { id: string; name: string | null };
  trigger: string;
  periodKey: string;
  sentAt: string;
  dueAt: string | null;
  closesAt: string | null;
  status: string;
  late: boolean;
  version: { id: string; version: number; questions: Question[] };
}

export type AthleteStatus = "pending" | "missed";

export async function listAthleteRequests(
  clientId: string,
  statuses: AthleteStatus[],
  since?: Date,
  now = new Date(),
): Promise<{
  requests: AthleteRequestDTO[];
  deletedIds: string[];
  asOf: string;
}> {
  const asOf = listAsOf(now);
  const rows = await getDb()
    .select({
      request: coachFormRequests,
      title: coachForms.title,
      description: coachForms.description,
      coachName: profiles.fullName,
      version: coachFormVersions,
    })
    .from(coachFormRequests)
    .innerJoin(coachForms, eq(coachForms.id, coachFormRequests.formId))
    .innerJoin(
      coachFormVersions,
      eq(coachFormVersions.id, coachFormRequests.formVersionId),
    )
    .leftJoin(profiles, eq(profiles.id, coachFormRequests.trainerId))
    .where(
      and(
        eq(coachFormRequests.clientId, clientId),
        since
          ? gt(coachFormRequests.updatedAt, since)
          : inArray(coachFormRequests.status, ["pending", "missed"]),
      ),
    )
    // Coach-tab order: what's due first, then the order they were sent.
    .orderBy(
      sql`${coachFormRequests.dueAt} asc nulls last`,
      asc(coachFormRequests.sentAt),
      asc(coachFormRequests.createdAt),
    );
  const requests: AthleteRequestDTO[] = [];
  const deletedIds: string[] = [];
  for (const row of rows) {
    const r = row.request;
    const status = effectiveStatus(r, now);
    const show = (statuses as string[]).includes(status) && answerable(r, now);
    if (!show) {
      if (since) deletedIds.push(r.id);
      continue;
    }
    const closes = closesAt(r);
    requests.push({
      id: r.id,
      formId: r.formId,
      title: row.title,
      description: row.description,
      coach: { id: r.trainerId, name: row.coachName ?? null },
      trigger: r.trigger,
      periodKey: r.periodKey,
      sentAt: r.sentAt.toISOString(),
      dueAt: r.dueAt ? r.dueAt.toISOString() : null,
      closesAt: closes ? closes.toISOString() : null,
      status,
      late: status === "missed",
      version: {
        id: row.version.id,
        version: row.version.version,
        questions: row.version.questions as Question[],
      },
    });
  }
  return { requests, deletedIds, asOf };
}

export interface ResponseDTO {
  id: string;
  requestId: string;
  formId: string;
  title: string;
  trigger: string;
  periodKey: string;
  sentAt: string;
  submittedAt: string;
  late: boolean;
  answers: Record<string, unknown>;
  reviewedAt: string | null;
  replyText: string | null;
  version: { id: string; version: number; questions: Question[] };
}

export type SubmitResult =
  | { ok: true; replay: boolean; response: ResponseDTO }
  | { status: 404; code: "request_not_found" }
  | {
      status: 409;
      code: "request_closed";
      reason: "completed" | "cancelled" | "expired";
    }
  | {
      status: 422;
      code: "invalid_answers";
      errors: FieldError[];
    };

const responseColumns = {
  response: coachFormResponses,
  request: coachFormRequests,
  title: coachForms.title,
  version: coachFormVersions,
};

type ResponseRow = {
  response: CoachFormResponse;
  request: CoachFormRequest;
  title: string;
  version: typeof coachFormVersions.$inferSelect;
};

function responseDto(row: ResponseRow): ResponseDTO {
  return {
    id: row.response.id,
    requestId: row.request.id,
    formId: row.request.formId,
    title: row.title,
    trigger: row.request.trigger,
    periodKey: row.request.periodKey,
    sentAt: row.request.sentAt.toISOString(),
    submittedAt: row.response.submittedAt.toISOString(),
    late: row.request.late,
    answers: row.response.answers,
    reviewedAt: row.response.reviewedAt
      ? row.response.reviewedAt.toISOString()
      : null,
    replyText: row.response.replyText,
    version: {
      id: row.version.id,
      version: row.version.version,
      questions: row.version.questions as Question[],
    },
  };
}

async function readResponse(
  db: DbOrTx,
  where: ReturnType<typeof and>,
): Promise<ResponseDTO | null> {
  const rows = await db
    .select(responseColumns)
    .from(coachFormResponses)
    .innerJoin(
      coachFormRequests,
      eq(coachFormRequests.id, coachFormResponses.requestId),
    )
    .innerJoin(coachForms, eq(coachForms.id, coachFormRequests.formId))
    .innerJoin(
      coachFormVersions,
      eq(coachFormVersions.id, coachFormRequests.formVersionId),
    )
    .where(where)
    .limit(1);
  return rows[0] ? responseDto(rows[0]) : null;
}

/**
 * `POST /users/me/form-requests/:id/response`. A replay with the same
 * `Idempotency-Key` returns the stored response, checked under the request's
 * row lock and before the closed check, so it works even after the request
 * has closed and even when the retry overlaps the first submit.
 */
export async function submitResponse(
  clientId: string,
  requestId: string,
  answers: unknown,
  clientRequestId: string | null,
  now = new Date(),
): Promise<SubmitResult> {
  let pendingEvent: string | null = null;
  // PER-121: HeadObject pending photo answers before the request row is
  // locked; the transaction below then only reads their state.
  await finalisePhotoAnswers(clientId, answers);
  const result = await getDb().transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(coachFormRequests)
      .where(
        and(
          eq(coachFormRequests.id, requestId),
          eq(coachFormRequests.clientId, clientId),
        ),
      )
      .limit(1)
      .for("update");
    const request = rows[0];
    if (!request) {
      return { status: 404 as const, code: "request_not_found" as const };
    }
    // After the lock: a retry overlapping the first submit waits here, then
    // finds the stored response instead of a 409 (Inspector Brad, #543).
    if (clientRequestId) {
      const replay = await readResponse(
        tx,
        and(
          eq(coachFormResponses.clientId, clientId),
          eq(coachFormResponses.clientRequestId, clientRequestId),
        ),
      );
      if (replay) return { ok: true as const, replay: true, response: replay };
    }
    if (!answerable(request, now)) {
      const status = effectiveStatus(request, now);
      return {
        status: 409 as const,
        code: "request_closed" as const,
        reason:
          status === "completed"
            ? ("completed" as const)
            : status === "cancelled"
              ? ("cancelled" as const)
              : ("expired" as const),
      };
    }
    const version = await tx
      .select()
      .from(coachFormVersions)
      .where(eq(coachFormVersions.id, request.formVersionId))
      .limit(1);
    const checked = validateAnswers(
      version[0]!.questions as Question[],
      answers,
    );
    if (!checked.ok) {
      return {
        status: 422 as const,
        code: "invalid_answers" as const,
        errors: checked.errors,
      };
    }
    // PER-121: each photo answer must be the athlete's own finished upload,
    // not already used in another response.
    const photoAnswers = (version[0]!.questions as Question[])
      .filter((q) => q.type === "photo" && Object.hasOwn(checked.value, q.id))
      .map((q) => ({
        at: q.id,
        mediaId: (checked.value[q.id] as { mediaId: string }).mediaId,
      }));
    const photoIds = photoAnswers.map((p) => p.mediaId);
    const problems = await lockPhotoAnswers(tx, clientId, photoIds);
    if (problems.length > 0) {
      return {
        status: 422 as const,
        code: "invalid_answers" as const,
        errors: problems.map((p) => ({
          at: photoAnswers.find((a) => a.mediaId === p.mediaId)!.at,
          message: p.message,
        })),
      };
    }
    const late = effectiveStatus(request, now) === "missed";
    const inserted = await tx
      .insert(coachFormResponses)
      .values({
        requestId: request.id,
        clientId,
        answers: checked.value,
        submittedAt: now,
        clientRequestId,
      })
      .returning({ id: coachFormResponses.id });
    await attachPhotoAnswers(tx, clientId, photoIds, inserted[0]!.id);
    await tx
      .update(coachFormRequests)
      .set({ status: "completed", completedAt: now, late, updatedAt: now })
      .where(eq(coachFormRequests.id, request.id));
    const response = await readResponse(
      tx,
      eq(coachFormResponses.id, inserted[0]!.id),
    );
    // PER-117 (design C D4): the coach hears about it. Recurring check-ins
    // are `check_in_completed`; every other form is `form_completed`.
    pendingEvent = await recordCoachEvent(
      tx,
      {
        trainerId: request.trainerId,
        clientId,
        relationshipId: request.relationshipId,
        kind:
          request.trigger === "weekly" || request.trigger === "daily"
            ? "check_in_completed"
            : "form_completed",
        entityType: "coach_form_response",
        entityId: response!.id,
        payload: {
          requestId: request.id,
          responseId: response!.id,
          formId: request.formId,
          formTitle: response!.title,
          trigger: request.trigger,
          late,
        },
        occurredAt: now,
        dedupeKey: `form_completed:${request.id}`,
      },
      now,
    );
    return { ok: true as const, replay: false, response: response! };
  });
  if (pendingEvent) await deliverCoachEvents([pendingEvent]);
  return result;
}

// ─── Coach ───────────────────────────────────────────────────────────────────

/**
 * What a coach may see of one client's forms.
 *  - `active`: the current coaching cycle (requests sent since the
 *    relationship last became active), plus every exit form of theirs.
 *  - `ended`: only the exit forms (Brad, 20 Nov). Nothing else is visible
 *    after coaching ends.
 */
export type CoachView =
  | {
      kind: "active";
      trainerId: string;
      clientId: string;
      relationshipId: string;
      activatedAt: Date | null;
    }
  | { kind: "ended"; trainerId: string; clientId: string };

/**
 * Which of a client's requests this coach may see. Exported for PER-121:
 * a photo answer is visible to a coach under exactly the same rule as the
 * response it belongs to.
 */
export function visibleRequests(view: CoachView) {
  const base = and(
    eq(coachFormRequests.trainerId, view.trainerId),
    eq(coachFormRequests.clientId, view.clientId),
  );
  if (view.kind === "ended") {
    return and(base, eq(coachFormRequests.trigger, "on_end"));
  }
  return and(
    base,
    or(
      eq(coachFormRequests.trigger, "on_end"),
      and(
        eq(coachFormRequests.relationshipId, view.relationshipId),
        view.activatedAt
          ? gte(coachFormRequests.sentAt, view.activatedAt)
          : undefined,
      ),
    ),
  );
}

/**
 * For an ended relationship: the coach may still read exit forms if they
 * coached this athlete. Null when they never did.
 */
export async function endedCoachView(
  trainerId: string,
  clientId: string,
): Promise<CoachView | null> {
  const rows = await getDb()
    .select({ id: ptClientRelationships.id })
    .from(ptClientRelationships)
    .where(
      and(
        eq(ptClientRelationships.trainerId, trainerId),
        eq(ptClientRelationships.clientId, clientId),
        ne(ptClientRelationships.status, "active"),
      ),
    )
    .limit(1);
  return rows[0] ? { kind: "ended", trainerId, clientId } : null;
}

const PAGE = 20;

export async function listCoachResponses(
  view: CoachView,
  opts: { formId?: string; cursor?: string; limit?: number },
): Promise<{ responses: ResponseDTO[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(opts.limit ?? PAGE, 1), 50);
  let after: { at: Date; id: string } | null = null;
  if (opts.cursor) {
    const [at, id] = opts.cursor.split("_");
    const date = new Date(at ?? "");
    if (!Number.isNaN(date.getTime()) && id) after = { at: date, id };
  }
  const rows = await getDb()
    .select(responseColumns)
    .from(coachFormResponses)
    .innerJoin(
      coachFormRequests,
      eq(coachFormRequests.id, coachFormResponses.requestId),
    )
    .innerJoin(coachForms, eq(coachForms.id, coachFormRequests.formId))
    .innerJoin(
      coachFormVersions,
      eq(coachFormVersions.id, coachFormRequests.formVersionId),
    )
    .where(
      and(
        visibleRequests(view),
        opts.formId ? eq(coachFormRequests.formId, opts.formId) : undefined,
        after
          ? or(
              lt(coachFormResponses.submittedAt, after.at),
              and(
                eq(coachFormResponses.submittedAt, after.at),
                lt(coachFormResponses.id, after.id),
              ),
            )
          : undefined,
      ),
    )
    .orderBy(desc(coachFormResponses.submittedAt), desc(coachFormResponses.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit).map(responseDto);
  const last = page[page.length - 1];
  return {
    responses: page,
    nextCursor:
      rows.length > limit && last ? `${last.submittedAt}_${last.id}` : null,
  };
}

export const REPLY_MAX = 2000;

/** Mark reviewed (first review time kept); `replyText` replaces the reply. */
export async function reviewResponse(
  view: CoachView,
  responseId: string,
  replyText: string | undefined,
): Promise<ResponseDTO | null> {
  return getDb().transaction(async (tx) => {
    const visible = await tx
      .select({ id: coachFormResponses.id })
      .from(coachFormResponses)
      .innerJoin(
        coachFormRequests,
        eq(coachFormRequests.id, coachFormResponses.requestId),
      )
      .where(and(eq(coachFormResponses.id, responseId), visibleRequests(view)))
      .limit(1);
    if (!visible[0]) return null;
    const now = new Date();
    await tx
      .update(coachFormResponses)
      .set({
        reviewedAt: sql`coalesce(${coachFormResponses.reviewedAt}, ${now.toISOString()}::timestamptz)`,
        reviewedBy: view.trainerId,
        ...(replyText !== undefined
          ? { replyText: stripNul(replyText).trim() || null }
          : {}),
      })
      .where(eq(coachFormResponses.id, responseId));
    return readResponse(tx, eq(coachFormResponses.id, responseId));
  });
}

// ─── Check-ins tab (C3.3) ────────────────────────────────────────────────────

export interface ClientFormRuleDTO {
  scheduleId: string;
  trigger: string;
  audience: string;
  status: string;
  clientStatus: string | null;
  weekday: number | null;
  timeLocal: string | null;
  dueAfterHours: number | null;
  reminders: { afterHours: number }[];
  override: Record<string, unknown> | null;
}

export interface ClientFormDTO {
  form: { id: string; title: string; archivedAt: string | null };
  rule: ClientFormRuleDTO | null;
  rules: ClientFormRuleDTO[];
  lastDoneAt: string | null;
  lastSentAt: string | null;
  pendingRequestId: string | null;
  state: "done" | "notDoneYet" | "paused";
}

const RULE_PRIORITY: Record<string, number> = {
  weekly: 0,
  daily: 1,
  once: 2,
  on_join: 3,
  on_end: 4,
};

/** Every form this coach sends (or has sent) to one active client. */
export async function listClientForms(
  view: Extract<CoachView, { kind: "active" }>,
  onlyFormId?: string,
  now = new Date(),
): Promise<ClientFormDTO[]> {
  const db = getDb();
  const schedules = await db
    .select({ schedule: coachFormSchedules, target: coachFormScheduleClients })
    .from(coachFormSchedules)
    .leftJoin(
      coachFormScheduleClients,
      and(
        eq(coachFormScheduleClients.scheduleId, coachFormSchedules.id),
        eq(coachFormScheduleClients.relationshipId, view.relationshipId),
      ),
    )
    .where(
      and(
        eq(coachFormSchedules.trainerId, view.trainerId),
        ne(coachFormSchedules.status, "stopped"),
        onlyFormId ? eq(coachFormSchedules.formId, onlyFormId) : undefined,
      ),
    );
  const rulesByForm = new Map<string, ClientFormRuleDTO[]>();
  for (const { schedule: s, target } of schedules) {
    const reaches =
      s.audience === "selected"
        ? target !== null && target.status !== "excluded"
        : target === null || target.status !== "excluded";
    if (!reaches) continue;
    const rule: ClientFormRuleDTO = {
      scheduleId: s.id,
      trigger: s.trigger,
      audience: s.audience,
      status: s.status,
      clientStatus: target?.status ?? null,
      weekday: s.weekday,
      timeLocal: hhmm(s.timeLocal),
      dueAfterHours: s.dueAfterHours,
      reminders: s.reminders,
      override: target?.override ?? null,
    };
    rulesByForm.set(s.formId, [...(rulesByForm.get(s.formId) ?? []), rule]);
  }

  const requests = await db
    .select()
    .from(coachFormRequests)
    .where(
      and(
        visibleRequests(view),
        onlyFormId ? eq(coachFormRequests.formId, onlyFormId) : undefined,
      ),
    )
    .orderBy(desc(coachFormRequests.sentAt));
  const formIds = [
    ...new Set([...rulesByForm.keys(), ...requests.map((r) => r.formId)]),
  ];
  if (formIds.length === 0) return [];
  const forms = await db
    .select({
      id: coachForms.id,
      title: coachForms.title,
      archivedAt: coachForms.archivedAt,
    })
    .from(coachForms)
    .where(
      and(
        inArray(coachForms.id, formIds),
        eq(coachForms.trainerId, view.trainerId),
      ),
    );

  const result: ClientFormDTO[] = forms.map((f) => {
    const rules = (rulesByForm.get(f.id) ?? []).sort(
      (a, b) => RULE_PRIORITY[a.trigger]! - RULE_PRIORITY[b.trigger]!,
    );
    const mine = requests.filter((r) => r.formId === f.id);
    const done = mine
      .filter((r) => r.completedAt)
      .map((r) => r.completedAt!.getTime());
    const lastDoneAt = done.length > 0 ? new Date(Math.max(...done)) : null;
    const pending = mine.find((r) => answerable(r, now));
    const paused =
      rules.length > 0 &&
      rules.every((r) => r.status === "paused" || r.clientStatus === "paused");
    return {
      form: {
        id: f.id,
        title: f.title,
        archivedAt: f.archivedAt ? f.archivedAt.toISOString() : null,
      },
      rule: rules[0] ?? null,
      rules,
      lastDoneAt: lastDoneAt ? lastDoneAt.toISOString() : null,
      lastSentAt: mine[0] ? mine[0].sentAt.toISOString() : null,
      pendingRequestId: pending?.id ?? null,
      state: paused ? "paused" : lastDoneAt ? "done" : "notDoneYet",
    };
  });
  // Most recent activity first.
  return result.sort((a, b) =>
    (b.lastSentAt ?? "").localeCompare(a.lastSentAt ?? ""),
  );
}

// ─── Per-client setup (C10j) ─────────────────────────────────────────────────

export type ClientSetupResult =
  | { ok: true; form: ClientFormDTO | null }
  | { status: 404; code: "form_not_found" | "schedule_not_found" }
  | { status: 422; code: "invalid_schedule"; message: string };

/**
 * `PUT /trainers/me/clients/:clientId/forms/:formId/setup`: this client only.
 * Applies to every live rule of the form (or one, with `scheduleId`).
 * `paused` stops new requests; `excluded` also cancels pending ones;
 * `active` (re)starts and sends a `once` form straight away.
 */
export async function setClientFormSetup(
  view: Extract<CoachView, { kind: "active" }>,
  formId: string,
  input: {
    status: "active" | "paused" | "excluded";
    override?: Record<string, unknown> | null;
    scheduleId?: string;
  },
): Promise<ClientSetupResult> {
  const result = await getDb().transaction(async (tx) => {
    const form = await tx
      .select({ id: coachForms.id })
      .from(coachForms)
      .where(
        and(
          eq(coachForms.id, formId),
          eq(coachForms.trainerId, view.trainerId),
        ),
      )
      .limit(1);
    if (!form[0]) {
      return { status: 404 as const, code: "form_not_found" as const };
    }
    const schedules = await tx
      .select()
      .from(coachFormSchedules)
      .where(
        and(
          eq(coachFormSchedules.trainerId, view.trainerId),
          eq(coachFormSchedules.formId, formId),
          ne(coachFormSchedules.status, "stopped"),
          input.scheduleId
            ? eq(coachFormSchedules.id, input.scheduleId)
            : undefined,
        ),
      );
    if (schedules.length === 0) {
      return { status: 404 as const, code: "schedule_not_found" as const };
    }
    for (const s of schedules) {
      let override: Record<string, unknown> | null | undefined = undefined;
      if (input.override === null) override = null;
      else if (input.override !== undefined) {
        const checked = checkRule(s.trigger as Trigger, input.override);
        if (!checked.ok) {
          return {
            status: 422 as const,
            code: "invalid_schedule" as const,
            message: checked.message,
          };
        }
        override = checked.rule as Record<string, unknown>;
      }
      const now = new Date();
      await tx
        .insert(coachFormScheduleClients)
        .values({
          scheduleId: s.id,
          clientId: view.clientId,
          relationshipId: view.relationshipId,
          status: input.status,
          override: override ?? null,
        })
        .onConflictDoUpdate({
          target: [
            coachFormScheduleClients.scheduleId,
            coachFormScheduleClients.relationshipId,
          ],
          set: {
            status: input.status,
            ...(override !== undefined ? { override } : {}),
            updatedAt: now,
          },
        });
      if (input.status === "excluded") {
        await cancelScheduleRequests(tx, s.id, [view.relationshipId]);
      }
      if (input.status === "active") {
        await generateOnce(tx, s, view.relationshipId);
      }
    }
    return { ok: true as const };
  });
  if (!("ok" in result)) return result;
  const forms = await listClientForms(view, formId);
  return { ok: true, form: forms[0] ?? null };
}
