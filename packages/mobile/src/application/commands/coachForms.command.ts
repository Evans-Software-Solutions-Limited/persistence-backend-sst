/**
 * PER-129 (APP-C1) — coach forms writes, offline-first.
 *
 * Every write caches optimistically and goes through the sync queue:
 *
 * | entity type               | request                                              |
 * | ------------------------- | ---------------------------------------------------- |
 * | `coach_form`              | POST /trainers/me/forms (Idempotency-Key)            |
 * |                           | PATCH /trainers/me/forms/:id + `expectedRevision`    |
 * | `coach_form_schedule`     | POST /trainers/me/form-schedules (Idempotency-Key)   |
 * |                           | PATCH /trainers/me/form-schedules/:id + revision     |
 * | `coach_client_form_setup` | PUT …/clients/:clientId/forms/:formId/setup          |
 * | `coach_form_review`       | POST …/clients/:clientId/form-responses/:id/review   |
 *
 * Entity ids are `<userId>:<id…>` so the drain knows whose cache to update.
 *
 * Revisions: an edit folds into a queued, never-sent row for the same form
 * (or rule). Otherwise it queues its own PATCH carrying the revision the
 * phone has; when an earlier PATCH (or the create) succeeds, later queued
 * PATCHes that were based on the same revision move to the server's new one
 * — they are this phone's own chain, not a conflict.
 *
 * A 409 `revision_conflict` means someone else edited it: the cache takes the
 * server copy (`current`), every queued edit of it is dropped (each was based
 * on the old revision and would 409 too) and the conflict is recorded so the
 * screens say "Edited on another device". The exception is a rule's
 * status-only stop (a new "When" queues it beside the new rule's POST): it
 * goes again at the server's revision, so the form never goes out on both
 * cadences.
 */
import type { StoragePort, SyncQueueEntry } from "@/domain/ports/storage.port";
import { isAutoResolvableSyncEntry } from "@/domain/ports/sync.types";
import {
  formConflictKey,
  scheduleConflictKey,
  type ClientForm,
  type ClientFormRule,
  type ClientSetupInput,
  type CoachForm,
  type CoachFormsLibrary,
  type FormDraft,
  type FormResponse,
  type FormSchedule,
  type ScheduleDraft,
} from "@/domain/models/coachForms";
import {
  cleanQuestion,
  fitRuleToTrigger,
} from "@/domain/services/coachForms.service";

export const COACH_FORM_ENTITY = "coach_form";
export const COACH_FORM_SCHEDULE_ENTITY = "coach_form_schedule";
export const COACH_CLIENT_FORM_SETUP_ENTITY = "coach_client_form_setup";
export const COACH_FORM_REVIEW_ENTITY = "coach_form_review";
export const COACH_FORMS_ENTITIES: readonly string[] = [
  COACH_FORM_ENTITY,
  COACH_FORM_SCHEDULE_ENTITY,
  COACH_CLIENT_FORM_SETUP_ENTITY,
  COACH_FORM_REVIEW_ENTITY,
];

export const FORMS_ENDPOINT = "/trainers/me/forms";
export const SCHEDULES_ENDPOINT = "/trainers/me/form-schedules";

export type CoachFormsDeps = {
  storage: StoragePort;
  userId: string;
  now?: () => Date;
};

export function isLocalId(id: string): boolean {
  return id.startsWith("local-");
}

/**
 * `local-…` → server id for creates synced while the app has been running,
 * so a screen opened on an offline-created form or rule follows it once it
 * syncs (the cache only knows the new id).
 */
const syncedIds = new Map<string, string>();

export function resolveCoachFormsId(id: string): string {
  return syncedIds.get(id) ?? id;
}

function newLocalId(): string {
  return `local-${Date.now().toString(36)}${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

function nowIso(deps: CoachFormsDeps): string {
  return (deps.now?.() ?? new Date()).toISOString();
}

function parseObject(payload: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(payload) as unknown;
    return typeof v === "object" && v !== null && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** A queued row nothing has sent yet: safe to fold a newer edit into. */
function isFoldable(e: SyncQueueEntry): boolean {
  return (
    (e.status === "pending" || e.status === "failed") &&
    e.retryCount < e.maxRetries &&
    e.dispatchCount === 0
  );
}

/** Rows for one entity that can still reach the server on their own. */
export function liveEntries(
  storage: StoragePort,
  entityType: string,
  entityId: string,
): SyncQueueEntry[] {
  return storage
    .getQueuedEntriesForEntity(entityType, entityId)
    .filter(isAutoResolvableSyncEntry);
}

function emptyLibrary(deps: CoachFormsDeps): CoachFormsLibrary {
  return { forms: [], templates: [], asOf: nowIso(deps) };
}

// ── Forms ────────────────────────────────────────────────────────────────────

/**
 * Save the C10b editor: a new form (POST, keyed) or an edit (PATCH with
 * `expectedRevision`). Returns the form as cached.
 */
export function saveFormCommand(
  deps: CoachFormsDeps,
  draft: FormDraft,
): CoachForm {
  const { storage, userId } = deps;
  const now = nowIso(deps);
  const body = {
    title: draft.title.trim(),
    description: draft.description?.trim() ? draft.description.trim() : null,
    questions: draft.questions.map(cleanQuestion),
  };
  const library = storage.getCachedCoachForms(userId) ?? emptyLibrary(deps);

  if (!draft.id) {
    const id = newLocalId();
    const form: CoachForm = {
      id,
      title: body.title,
      description: body.description,
      templateKey: null,
      available: true,
      revision: 0,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
      version: {
        id: `${id}-v`,
        version: 0,
        questions: body.questions,
        createdAt: now,
      },
    };
    storage.cacheCoachForms(userId, {
      ...library,
      forms: [form, ...library.forms],
    });
    storage.enqueueMutation({
      entityType: COACH_FORM_ENTITY,
      entityId: `${userId}:${id}`,
      operation: "create",
      payload: body,
      endpoint: FORMS_ENDPOINT,
      method: "POST",
    });
    return form;
  }

  const id = draft.id;
  const existing = library.forms.find((f) => f.id === id);
  const form: CoachForm = {
    ...(existing ?? {
      id,
      templateKey: null,
      available: true,
      revision: 0,
      archivedAt: null,
      createdAt: now,
    }),
    title: body.title,
    description: body.description,
    updatedAt: now,
    version: {
      id: existing?.version?.id ?? `${id}-v`,
      version: existing?.version?.version ?? 0,
      createdAt: existing?.version?.createdAt ?? now,
      questions: body.questions,
    },
  };
  storage.cacheCoachForms(userId, {
    ...library,
    forms: existing
      ? library.forms.map((f) => (f.id === id ? form : f))
      : [form, ...library.forms],
  });

  const entityId = `${userId}:${id}`;
  const foldInto = liveEntries(storage, COACH_FORM_ENTITY, entityId)
    .filter(isFoldable)
    .at(-1);
  if (foldInto) {
    const prev = parseObject(foldInto.payload) ?? {};
    storage.updateMutationPayload(foldInto.id, { ...prev, ...body });
    return form;
  }
  storage.enqueueMutation({
    entityType: COACH_FORM_ENTITY,
    entityId,
    operation: "update",
    // 0 = "the create hasn't answered yet"; rebased when it does.
    payload: { ...body, expectedRevision: form.revision },
    endpoint: `${FORMS_ENDPOINT}/${id}`,
    method: "PATCH",
  });
  return form;
}

// ── Send rules ───────────────────────────────────────────────────────────────

function scheduleBody(draft: ScheduleDraft) {
  const rule = fitRuleToTrigger(draft.trigger, draft);
  return {
    audience: draft.audience,
    ...(draft.audience === "selected" ? { clientIds: draft.clientIds } : {}),
    weekday: rule.weekday,
    timeLocal: rule.timeLocal,
    dueAfterHours: rule.dueAfterHours,
    reminders: rule.reminders,
  };
}

/** Optimistically show a newly sent form in each chosen client's "Sent to". */
function addToClientForms(
  deps: CoachFormsDeps,
  schedule: FormSchedule,
  formTitle: string,
): void {
  const { storage, userId } = deps;
  if (schedule.audience !== "selected") return;
  const rule: ClientFormRule = {
    scheduleId: schedule.id,
    trigger: schedule.trigger,
    audience: schedule.audience,
    status: schedule.status,
    clientStatus: "active",
    weekday: schedule.weekday,
    timeLocal: schedule.timeLocal,
    dueAfterHours: schedule.dueAfterHours,
    reminders: schedule.reminders,
    override: null,
  };
  for (const c of schedule.clients) {
    const cached = storage.getCachedCoachClientForms(userId, c.clientId);
    if (!cached || cached.some((f) => f.form.id === schedule.formId)) continue;
    storage.cacheCoachClientForms(userId, c.clientId, [
      {
        form: { id: schedule.formId, title: formTitle, archivedAt: null },
        rule,
        rules: [rule],
        lastDoneAt: null,
        lastSentAt: null,
        pendingRequestId: null,
        state: "notDoneYet",
      },
      ...cached,
    ]);
  }
}

/**
 * Save the C10h send sheet: a new rule (POST, keyed), or an edit of an
 * existing one (PATCH with `expectedRevision`). The server can't change an
 * existing rule's trigger, so a new "When" stops the old rule and sends a
 * new one.
 */
export function saveScheduleCommand(
  deps: CoachFormsDeps,
  draft: ScheduleDraft,
): FormSchedule {
  const { storage, userId } = deps;
  const now = nowIso(deps);
  const schedules = storage.getCachedCoachFormSchedules(userId) ?? [];
  const existing = draft.scheduleId
    ? schedules.find((s) => s.id === draft.scheduleId)
    : undefined;
  const body = scheduleBody(draft);
  const formTitle =
    storage
      .getCachedCoachForms(userId)
      ?.forms.find((f) => f.id === draft.formId)?.title ?? "";

  if (existing && existing.trigger === draft.trigger) {
    const next: FormSchedule = {
      ...existing,
      audience: draft.audience,
      weekday: body.weekday,
      timeLocal: body.timeLocal,
      dueAfterHours: body.dueAfterHours,
      reminders: body.reminders,
      clients:
        draft.audience === "selected"
          ? draft.clientIds.map(
              (clientId) =>
                existing.clients.find((c) => c.clientId === clientId) ?? {
                  clientId,
                  relationshipId: "",
                  status: "active",
                  override: null,
                },
            )
          : existing.clients,
      updatedAt: now,
    };
    storage.cacheCoachFormSchedules(
      userId,
      schedules.map((s) => (s.id === next.id ? next : s)),
    );
    patchSchedule(deps, next.id, body, existing.revision);
    addToClientForms(deps, next, formTitle);
    return next;
  }

  if (existing) {
    // A different cadence: stop this rule, then send a new one below. A rule
    // made offline that nothing has sent yet is simply never sent.
    const unsentCreate = isLocalId(existing.id)
      ? liveEntries(
          storage,
          COACH_FORM_SCHEDULE_ENTITY,
          `${userId}:${existing.id}`,
        ).filter((e) => e.operation === "create" && isFoldable(e))
      : [];
    if (unsentCreate.length > 0) {
      storage.discardEntries(
        liveEntries(
          storage,
          COACH_FORM_SCHEDULE_ENTITY,
          `${userId}:${existing.id}`,
        ).map((e) => e.id),
      );
      storage.cacheCoachFormSchedules(
        userId,
        schedules.filter((s) => s.id !== existing.id),
      );
    } else {
      storage.cacheCoachFormSchedules(
        userId,
        schedules.map((s) =>
          s.id === existing.id ? { ...s, status: "stopped" as const } : s,
        ),
      );
      patchSchedule(
        deps,
        existing.id,
        { status: "stopped" },
        existing.revision,
      );
    }
  }

  const id = newLocalId();
  const created: FormSchedule = {
    id,
    formId: draft.formId,
    trigger: draft.trigger,
    audience: draft.audience,
    weekday: body.weekday,
    timeLocal: body.timeLocal,
    dueAfterHours: body.dueAfterHours,
    reminders: body.reminders,
    status: "active",
    revision: 0,
    clients:
      draft.audience === "selected"
        ? draft.clientIds.map((clientId) => ({
            clientId,
            relationshipId: "",
            status: "active",
            override: null,
          }))
        : [],
    createdAt: now,
    updatedAt: now,
  };
  storage.cacheCoachFormSchedules(userId, [
    ...(storage.getCachedCoachFormSchedules(userId) ?? []),
    created,
  ]);
  storage.enqueueMutation({
    entityType: COACH_FORM_SCHEDULE_ENTITY,
    entityId: `${userId}:${id}`,
    operation: "create",
    payload: { formId: draft.formId, trigger: draft.trigger, ...body },
    endpoint: SCHEDULES_ENDPOINT,
    method: "POST",
  });
  addToClientForms(deps, created, formTitle);
  return created;
}

function patchSchedule(
  deps: CoachFormsDeps,
  scheduleId: string,
  body: Record<string, unknown>,
  revision: number,
): void {
  const { storage, userId } = deps;
  const entityId = `${userId}:${scheduleId}`;
  const foldInto = liveEntries(storage, COACH_FORM_SCHEDULE_ENTITY, entityId)
    .filter(isFoldable)
    .at(-1);
  if (foldInto) {
    const merged: Record<string, unknown> = {
      ...(parseObject(foldInto.payload) ?? {}),
      ...body,
    };
    // An earlier Selected edit's clients don't carry over to All clients:
    // the server rejects clientIds there (422).
    if (merged.audience === "all_clients") delete merged.clientIds;
    storage.updateMutationPayload(foldInto.id, merged);
    return;
  }
  storage.enqueueMutation({
    entityType: COACH_FORM_SCHEDULE_ENTITY,
    entityId,
    operation: "update",
    payload: { ...body, expectedRevision: revision },
    endpoint: `${SCHEDULES_ENDPOINT}/${scheduleId}`,
    method: "PATCH",
  });
}

// ── C10j per-client setup ────────────────────────────────────────────────────

function applySetupLocally(
  form: ClientForm,
  input: ClientSetupInput,
): ClientForm {
  const rules = form.rules.map((r) => {
    if (input.scheduleId && r.scheduleId !== input.scheduleId) return r;
    const override =
      input.override === undefined
        ? r.override
        : input.override === null
          ? null
          : { ...(r.override ?? {}), ...input.override };
    return { ...r, clientStatus: input.status, override };
  });
  const paused =
    rules.length > 0
      ? rules.every((r) => r.status === "paused" || r.clientStatus === "paused")
      : input.status === "paused";
  return {
    ...form,
    rules,
    rule: rules[0] ?? null,
    state: paused ? "paused" : form.lastDoneAt ? "done" : "notDoneYet",
  };
}

/**
 * The queued setup row a new write for `scheduleId` folds into, if any.
 * Writes are keyed by rule: from the newest row back, rows for other rules
 * are passed over (they're independent), the newest row for the same rule
 * is the one, if nothing has sent it yet. A whole-form write (no
 * `scheduleId`, e.g. Stop) is a barrier either way: nothing folds across it,
 * so the order the server sees stays the coach's.
 */
function setupFoldTarget(
  rows: SyncQueueEntry[],
  scheduleId: string | undefined,
): { row: SyncQueueEntry; prev: Record<string, unknown> } | null {
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i]!;
    const prev = parseObject(row.payload);
    if (!prev) return null;
    const rowRule = typeof prev.scheduleId === "string" ? prev.scheduleId : "";
    if (rowRule === (scheduleId ?? "")) {
      return isFoldable(row) ? { row, prev } : null;
    }
    if (!rowRule || !scheduleId) return null;
  }
  return null;
}

/**
 * C10j Pause / Stop / Save for one client. PUT, no revision (last write
 * wins), so a newer choice for the same rule (`scheduleId`, or every rule
 * when absent) folds into a queued one nothing sent yet; fields it leaves
 * out (a Pause's override) keep the queued value, as they would on the
 * server. Pause and Resume come one per rule (`setupPauseInputs`), so each
 * rule's write stays its own row. Offline-created ids resolve to the
 * server's once synced.
 */
export function setClientFormSetupCommand(
  deps: CoachFormsDeps,
  clientId: string,
  rawFormId: string,
  rawInput: ClientSetupInput,
): void {
  const { storage, userId } = deps;
  const formId = resolveCoachFormsId(rawFormId);
  const input: ClientSetupInput = rawInput.scheduleId
    ? { ...rawInput, scheduleId: resolveCoachFormsId(rawInput.scheduleId) }
    : rawInput;
  const cached = storage.getCachedCoachClientForms(userId, clientId);
  if (cached) {
    storage.cacheCoachClientForms(
      userId,
      clientId,
      input.status === "excluded"
        ? cached.filter((f) => f.form.id !== formId)
        : cached.map((f) =>
            f.form.id === formId ? applySetupLocally(f, input) : f,
          ),
    );
  }
  const entityId = `${userId}:${clientId}:${formId}`;
  const foldInto = setupFoldTarget(
    liveEntries(storage, COACH_CLIENT_FORM_SETUP_ENTITY, entityId),
    input.scheduleId,
  );
  if (foldInto) {
    storage.updateMutationPayload(foldInto.row.id, {
      ...foldInto.prev,
      ...input,
    });
    return;
  }
  storage.enqueueMutation({
    entityType: COACH_CLIENT_FORM_SETUP_ENTITY,
    entityId,
    operation: "update",
    payload: input,
    endpoint: `/trainers/me/clients/${clientId}/forms/${formId}/setup`,
    method: "PUT",
  });
}

// ── Review and reply ─────────────────────────────────────────────────────────

/**
 * Mark a response reviewed, optionally with a reply. Idempotent on the
 * server (the first review time is kept; a reply replaces the reply).
 */
export function reviewResponseCommand(
  deps: CoachFormsDeps,
  clientId: string,
  responseId: string,
  replyText?: string,
): void {
  const { storage, userId } = deps;
  const now = nowIso(deps);
  const reply = replyText?.trim();
  const cached = storage.getCachedCoachFormResponses(userId, clientId);
  if (cached) {
    storage.cacheCoachFormResponses(
      userId,
      clientId,
      cached.map((r) =>
        r.id === responseId
          ? {
              ...r,
              reviewedAt: r.reviewedAt ?? now,
              ...(replyText !== undefined ? { replyText: reply || null } : {}),
            }
          : r,
      ),
    );
  }
  const body = replyText !== undefined ? { replyText: reply ?? "" } : {};
  const entityId = `${userId}:${clientId}:${responseId}`;
  const foldInto = liveEntries(storage, COACH_FORM_REVIEW_ENTITY, entityId)
    .filter(isFoldable)
    .at(-1);
  if (foldInto) {
    const prev = parseObject(foldInto.payload) ?? {};
    storage.updateMutationPayload(foldInto.id, { ...prev, ...body });
    return;
  }
  storage.enqueueMutation({
    entityType: COACH_FORM_REVIEW_ENTITY,
    entityId,
    operation: "update",
    payload: body,
    endpoint: `/trainers/me/clients/${clientId}/form-responses/${responseId}/review`,
    method: "POST",
  });
}

// ── Queue replay: successes and 409s ─────────────────────────────────────────

function userOf(entry: SyncQueueEntry): string | null {
  const userId = entry.entityId?.split(":")[0];
  return userId ? userId : null;
}

function sentRevision(entry: SyncQueueEntry): number {
  const body = parseObject(entry.payload);
  return typeof body?.expectedRevision === "number" ? body.expectedRevision : 0;
}

/**
 * Move this phone's later queued PATCHes of the same form/rule from the
 * revision just sent to the server's new one. Returns whether any live edit
 * is still queued (then the cache keeps the phone's newer content).
 */
function rebaseLaterEdits(
  storage: StoragePort,
  entityType: string,
  entityId: string,
  doneId: number,
  from: number,
  to: number,
): boolean {
  const later = liveEntries(storage, entityType, entityId).filter(
    (e) => e.id !== doneId,
  );
  for (const e of later) {
    const body = parseObject(e.payload);
    if (
      e.method === "PATCH" &&
      body &&
      (body.expectedRevision === from || body.expectedRevision === 0)
    ) {
      storage.updateMutationPayload(e.id, { ...body, expectedRevision: to });
    }
  }
  return later.length > 0;
}

function adoptForm(
  storage: StoragePort,
  userId: string,
  entry: SyncQueueEntry,
  server: CoachForm,
  from: number,
): void {
  const editsQueued = rebaseLaterEdits(
    storage,
    COACH_FORM_ENTITY,
    `${userId}:${server.id}`,
    entry.id,
    from,
    server.revision,
  );
  const library = storage.getCachedCoachForms(userId);
  if (!library) return;
  const local = library.forms.find((f) => f.id === server.id);
  const next: CoachForm =
    editsQueued && local
      ? {
          ...server,
          title: local.title,
          description: local.description,
          version: server.version
            ? { ...server.version, questions: local.version?.questions ?? [] }
            : local.version,
        }
      : server;
  storage.cacheCoachForms(userId, {
    ...library,
    forms: local
      ? library.forms.map((f) => (f.id === server.id ? next : f))
      : [next, ...library.forms],
  });
}

function adoptSchedule(
  storage: StoragePort,
  userId: string,
  entry: SyncQueueEntry,
  server: FormSchedule,
  from: number,
): void {
  const editsQueued = rebaseLaterEdits(
    storage,
    COACH_FORM_SCHEDULE_ENTITY,
    `${userId}:${server.id}`,
    entry.id,
    from,
    server.revision,
  );
  const schedules = storage.getCachedCoachFormSchedules(userId) ?? [];
  const local = schedules.find((s) => s.id === server.id);
  const next: FormSchedule =
    editsQueued && local ? { ...local, revision: server.revision } : server;
  storage.cacheCoachFormSchedules(
    userId,
    local
      ? schedules.map((s) => (s.id === server.id ? next : s))
      : [...schedules, next],
  );
}

/**
 * A coach-forms row synced: take the server's answer into the cache, swap an
 * offline create's `local-…` id everywhere, and rebase later queued edits.
 * Non-fatal by contract: the request already succeeded.
 */
export function applyCoachFormsSyncSuccess(
  storage: StoragePort,
  entry: SyncQueueEntry,
  data: unknown,
): void {
  const userId = userOf(entry);
  if (!userId || typeof data !== "object") return;
  const idPart = entry.entityId!.split(":").slice(1);

  if (entry.entityType === COACH_FORM_ENTITY) {
    const form = data as CoachForm | null;
    if (!form?.id) return;
    if (entry.method === "POST") {
      const localId = idPart[0];
      if (localId) {
        storage.swapLocalCoachFormId(userId, localId, form.id);
        syncedIds.set(localId, form.id);
      }
      adoptForm(storage, userId, entry, form, 0);
      return;
    }
    adoptForm(storage, userId, entry, form, sentRevision(entry));
    return;
  }

  if (entry.entityType === COACH_FORM_SCHEDULE_ENTITY) {
    const schedule = data as FormSchedule | null;
    if (!schedule?.id) return;
    if (entry.method === "POST") {
      const localId = idPart[0];
      if (localId) {
        storage.swapLocalCoachFormScheduleId(userId, localId, schedule.id);
        syncedIds.set(localId, schedule.id);
      }
      adoptSchedule(storage, userId, entry, schedule, 0);
      return;
    }
    adoptSchedule(storage, userId, entry, schedule, sentRevision(entry));
    return;
  }

  if (entry.entityType === COACH_CLIENT_FORM_SETUP_ENTITY) {
    const [clientId, formId] = idPart;
    if (!clientId || !formId) return;
    const laterQueued = liveEntries(
      storage,
      COACH_CLIENT_FORM_SETUP_ENTITY,
      entry.entityId!,
    ).some((e) => e.id !== entry.id);
    const cached = storage.getCachedCoachClientForms(userId, clientId);
    if (laterQueued || !cached) return;
    const form = data as ClientForm | null;
    const without = cached.filter((f) => f.form.id !== formId);
    storage.cacheCoachClientForms(
      userId,
      clientId,
      form?.form
        ? cached.some((f) => f.form.id === formId)
          ? cached.map((f) => (f.form.id === formId ? form : f))
          : [form, ...cached]
        : without,
    );
    return;
  }

  if (entry.entityType === COACH_FORM_REVIEW_ENTITY) {
    const [clientId] = idPart;
    const response = data as FormResponse | null;
    if (!clientId || !response?.id) return;
    const laterQueued = liveEntries(
      storage,
      COACH_FORM_REVIEW_ENTITY,
      entry.entityId!,
    ).some((e) => e.id !== entry.id);
    const cached = storage.getCachedCoachFormResponses(userId, clientId);
    if (laterQueued || !cached) return;
    storage.cacheCoachFormResponses(
      userId,
      clientId,
      cached.map((r) => (r.id === response.id ? response : r)),
    );
  }
}

/**
 * A 409 `revision_conflict` on a form or send-rule PATCH: the cache takes the
 * server copy, every queued edit of it is dropped (this row included — it is
 * never retried), and the conflict is recorded for the screens. Returns false
 * for anything else, which then takes the drain's ordinary failure path.
 */
export function applyCoachFormsConflict(
  storage: StoragePort,
  entry: SyncQueueEntry,
  bodyText: string,
): boolean {
  if (
    entry.method !== "PATCH" ||
    (entry.entityType !== COACH_FORM_ENTITY &&
      entry.entityType !== COACH_FORM_SCHEDULE_ENTITY)
  ) {
    return false;
  }
  const userId = userOf(entry);
  const body = parseObject(bodyText);
  const current = body?.current as { id?: unknown } | undefined;
  if (
    !userId ||
    body?.code !== "revision_conflict" ||
    typeof current !== "object" ||
    current === null ||
    typeof current.id !== "string"
  ) {
    return false;
  }
  const id = current.id;
  if (entry.entityType === COACH_FORM_SCHEDULE_ENTITY && isStop(entry)) {
    resendStop(storage, userId, entry, current as FormSchedule);
    return true;
  }
  const queuedPatches = storage
    .getQueuedEntriesForEntity(entry.entityType, `${userId}:${id}`)
    .filter((e) => e.id !== entry.id && e.status !== "in_flight")
    .filter((e) => e.method === "PATCH");
  // A queued stop of this rule outlives the conflict: rebased onto the
  // server's revision, not dropped (Inspector Brad #556 sweep 3).
  const keptStops =
    entry.entityType === COACH_FORM_SCHEDULE_ENTITY
      ? queuedPatches.filter(isStop)
      : [];
  const stale = queuedPatches
    .filter((e) => !keptStops.includes(e))
    .map((e) => e.id);
  storage.discardEntries([entry.id, ...stale]);
  if (keptStops.length > 0) {
    rebaseStops(storage, userId, keptStops, current as FormSchedule);
    return true;
  }

  if (entry.entityType === COACH_FORM_ENTITY) {
    const server = current as CoachForm;
    const library = storage.getCachedCoachForms(userId);
    if (library) {
      const known = library.forms.some((f) => f.id === id);
      storage.cacheCoachForms(userId, {
        ...library,
        forms: known
          ? library.forms.map((f) => (f.id === id ? server : f))
          : [server, ...library.forms],
      });
    }
    storage.recordCoachFormConflict(userId, formConflictKey(id));
    return true;
  }

  const server = current as FormSchedule;
  const schedules = storage.getCachedCoachFormSchedules(userId);
  if (schedules) {
    const known = schedules.some((s) => s.id === id);
    storage.cacheCoachFormSchedules(
      userId,
      known
        ? schedules.map((s) => (s.id === id ? server : s))
        : [...schedules, server],
    );
  }
  storage.recordCoachFormConflict(userId, scheduleConflictKey(id));
  return true;
}

/**
 * A rule PATCH that stops it: `{status: "stopped"}`, or a stop folded into an
 * earlier queued edit (the rule's body plus `status: "stopped"`). Either
 * way the coach stopped this rule.
 */
function isStop(entry: SyncQueueEntry): boolean {
  return parseObject(entry.payload)?.status === "stopped";
}

/**
 * A 409 on a rule's stop. A new "When" queues this stop and a POST for the
 * new rule; dropping the stop would leave the form going out on both
 * cadences, and someone else's edit doesn't change that the coach stopped
 * this one. So the stop goes again at the server's revision as a plain
 * `{status: "stopped"}` (one retry charged, so a rule that keeps changing
 * still ends). If the server has it stopped already, there's nothing left
 * to send.
 */
function resendStop(
  storage: StoragePort,
  userId: string,
  entry: SyncQueueEntry,
  server: FormSchedule,
): void {
  if (server.status === "stopped") {
    storage.discardEntries([entry.id]);
  } else {
    storage.markMutationFailed(entry.id, "revision_conflict: stop re-sent");
    storage.updateMutationPayload(entry.id, {
      status: "stopped",
      expectedRevision: server.revision,
    });
  }
  cacheStopped(storage, userId, server);
}

/**
 * A 409 on an earlier PATCH of a rule that has a stop queued behind it: the
 * stop (not yet sent) moves to the server's revision as a plain stop, or
 * goes if the server has the rule stopped already.
 */
function rebaseStops(
  storage: StoragePort,
  userId: string,
  stops: SyncQueueEntry[],
  server: FormSchedule,
): void {
  if (server.status === "stopped") {
    storage.discardEntries(stops.map((e) => e.id));
  } else {
    for (const e of stops) {
      storage.updateMutationPayload(e.id, {
        status: "stopped",
        expectedRevision: server.revision,
      });
    }
  }
  cacheStopped(storage, userId, server);
}

function cacheStopped(
  storage: StoragePort,
  userId: string,
  server: FormSchedule,
): void {
  const schedules = storage.getCachedCoachFormSchedules(userId);
  if (!schedules) return;
  const next: FormSchedule = { ...server, status: "stopped" };
  storage.cacheCoachFormSchedules(
    userId,
    schedules.some((s) => s.id === server.id)
      ? schedules.map((s) => (s.id === server.id ? next : s))
      : [...schedules, next],
  );
}

// ── Reads: keep queued intent over an older server answer ───────────────────

/**
 * A library read never replaces forms with a live queued write (the queued
 * write is newer), and keeps forms created offline that the server hasn't
 * seen yet.
 */
export function reconcileCoachForms(
  storage: StoragePort,
  userId: string,
  server: CoachFormsLibrary,
): CoachFormsLibrary {
  const cached = storage.getCachedCoachForms(userId);
  if (!cached) return server;
  const pending = cached.forms.filter(
    (f) =>
      liveEntries(storage, COACH_FORM_ENTITY, `${userId}:${f.id}`).length > 0,
  );
  if (pending.length === 0) return server;
  const byId = new Map(pending.map((f) => [f.id, f]));
  const merged = server.forms.map((f) => byId.get(f.id) ?? f);
  const added = pending.filter((f) => !server.forms.some((s) => s.id === f.id));
  return { ...server, forms: [...added, ...merged] };
}

/** Same for send rules. */
export function reconcileCoachFormSchedules(
  storage: StoragePort,
  userId: string,
  server: FormSchedule[],
): FormSchedule[] {
  const cached = storage.getCachedCoachFormSchedules(userId);
  if (!cached) return server;
  const pending = cached.filter(
    (s) =>
      liveEntries(storage, COACH_FORM_SCHEDULE_ENTITY, `${userId}:${s.id}`)
        .length > 0,
  );
  if (pending.length === 0) return server;
  const byId = new Map(pending.map((s) => [s.id, s]));
  const merged = server.map((s) => byId.get(s.id) ?? s);
  const added = pending.filter((s) => !server.some((r) => r.id === s.id));
  return [...merged, ...added];
}

/** A client's "Sent to" list keeps forms with a queued setup change. */
export function reconcileClientForms(
  storage: StoragePort,
  userId: string,
  clientId: string,
  server: ClientForm[],
): ClientForm[] {
  const live = storage
    .getUncompletedMutations()
    .filter(
      (e) =>
        e.entityType === COACH_CLIENT_FORM_SETUP_ENTITY &&
        e.entityId?.startsWith(`${userId}:${clientId}:`) === true &&
        isAutoResolvableSyncEntry(e),
    );
  if (live.length === 0) return server;
  const cached = storage.getCachedCoachClientForms(userId, clientId) ?? [];
  const pendingForms = new Set(
    live.map((e) => e.entityId!.split(":")[2] ?? ""),
  );
  const out: ClientForm[] = [];
  for (const f of server) {
    if (!pendingForms.has(f.form.id)) {
      out.push(f);
      continue;
    }
    // Stopped here (excluded) → the cache dropped it; keep it dropped.
    const local = cached.find((c) => c.form.id === f.form.id);
    if (local) out.push(local);
  }
  return out;
}

/** Responses keep a queued review/reply over an older read. */
export function reconcileResponses(
  storage: StoragePort,
  userId: string,
  clientId: string,
  server: FormResponse[],
): FormResponse[] {
  const live = storage
    .getUncompletedMutations()
    .filter(
      (e) =>
        e.entityType === COACH_FORM_REVIEW_ENTITY &&
        e.entityId?.startsWith(`${userId}:${clientId}:`) === true &&
        isAutoResolvableSyncEntry(e),
    );
  if (live.length === 0) return server;
  const cached = storage.getCachedCoachFormResponses(userId, clientId) ?? [];
  const pending = new Set(live.map((e) => e.entityId!.split(":")[2] ?? ""));
  return server.map((r) =>
    pending.has(r.id) ? (cached.find((c) => c.id === r.id) ?? r) : r,
  );
}
