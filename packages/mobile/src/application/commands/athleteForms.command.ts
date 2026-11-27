/**
 * PER-130 (APP-C2) — the athlete's coach forms, offline-first (design C D6).
 *
 * - Due requests are cached with their questions (`cached_form_requests`),
 *   so a form can be filled in with no connection.
 * - Each request's draft and what happened when it was sent live in
 *   `form_request_local` ("Saved as you go"; "Waiting to send").
 * - Sending a form without photos queues
 *   `POST /users/me/form-requests/:id/response` (`form_response`); the
 *   queue stamps the `Idempotency-Key`, so a replay returns the stored
 *   response.
 * - A form with a photo needs a connection: the container uploads the photos
 *   and sends it straight away (`recordForm*` record the outcome).
 * - 409 `request_closed` (or 404) → "This check-in is no longer needed";
 *   422 `invalid_answers` → the form goes back to "To fill in" and shows the
 *   server's errors on its questions when it's opened.
 *
 * Entity ids are `<userId>:<requestId>` so the drain knows whose cache to update.
 */
import type { StoragePort, SyncQueueEntry } from "@/domain/ports/storage.port";
import { isAutoResolvableSyncEntry } from "@/domain/ports/sync.types";
import type { ApiPort } from "@/domain/ports/api.port";
import type {
  AnswerValue,
  AthleteFormRequest,
  FormResponseSubmit,
  LocalFormState,
} from "@/domain/models/athleteForms";

export const FORM_RESPONSE_ENTITY = "form_response";

export const formResponseEndpoint = (requestId: string) =>
  `/users/me/form-requests/${encodeURIComponent(requestId)}/response`;

export type AthleteFormsDeps = {
  storage: StoragePort;
  userId: string;
  now?: () => Date;
};

function nowIso(deps: { now?: () => Date }): string {
  return (deps.now?.() ?? new Date()).toISOString();
}

/** The local state for a request, or a fresh one. */
export function localStateFor(
  storage: StoragePort,
  userId: string,
  request: AthleteFormRequest,
  now: string,
): LocalFormState {
  const found = storage
    .getLocalFormStates(userId)
    .find((l) => l.requestId === request.id);
  return (
    found ?? {
      requestId: request.id,
      title: request.title,
      coachId: request.coach.id,
      trigger: request.trigger,
      answers: {},
      step: 0,
      updatedAt: now,
      submittedAt: null,
      sentAt: null,
      closed: false,
      rejected: null,
      submitKey: null,
      uploadKeys: {},
      introSeen: false,
    }
  );
}

function update(
  deps: AthleteFormsDeps,
  request: AthleteFormRequest,
  change: (state: LocalFormState, now: string) => Partial<LocalFormState>,
): LocalFormState {
  const now = nowIso(deps);
  const current = localStateFor(deps.storage, deps.userId, request, now);
  const next: LocalFormState = {
    ...current,
    ...change(current, now),
    updatedAt: now,
  };
  deps.storage.saveLocalFormState(deps.userId, next);
  return next;
}

/** "Saved as you go": the answers so far and the question on screen. */
export function saveFormDraftCommand(
  deps: AthleteFormsDeps,
  request: AthleteFormRequest,
  answers: Record<string, AnswerValue>,
  step: number,
): LocalFormState {
  return update(deps, request, (s) => {
    // Editing a send whose queue row died (retries used up) makes it a
    // draft for real: the dead row goes, so a reconnect can't revive and
    // send the old answers (Inspector Brad, #571). An untouched dead send
    // keeps its row and is still revived.
    if (
      s.submittedAt !== null &&
      s.sentAt === null &&
      !s.closed &&
      JSON.stringify(s.answers) !== JSON.stringify(answers) &&
      discardDeadRows(deps.storage, `${deps.userId}:${request.id}`)
    ) {
      return { answers, step, submittedAt: null };
    }
    return { answers, step };
  });
}

/**
 * Drop this request's queue rows that can no longer send on their own
 * (retries used up, refused for good). Returns false, dropping nothing,
 * while a live row still exists.
 */
function discardDeadRows(storage: StoragePort, entityId: string): boolean {
  const rows = storage
    .getQueuedEntriesForEntity(FORM_RESPONSE_ENTITY, entityId)
    .filter((e) => e.status !== "completed");
  if (rows.some(isAutoResolvableSyncEntry)) return false;
  if (rows.length > 0) storage.discardEntries(rows.map((e) => e.id));
  return true;
}

/** Keys for a form sent straight away, kept so a retry can't duplicate. */
export function ensureSubmitKeysCommand(
  deps: AthleteFormsDeps,
  request: AthleteFormRequest,
  photoFields: readonly string[],
  newKey: () => string,
): LocalFormState {
  return update(deps, request, (s) => {
    const uploadKeys = { ...s.uploadKeys };
    for (const field of photoFields) uploadKeys[field] ??= newKey();
    return { submitKey: s.submitKey ?? newKey(), uploadKeys };
  });
}

/** C10q "Later" or "Start the first one": don't open the page by itself again. */
export function markJoinIntroSeenCommand(
  deps: AthleteFormsDeps,
  requests: readonly AthleteFormRequest[],
): void {
  for (const r of requests) update(deps, r, () => ({ introSeen: true }));
}

/** Drop a request from the cached list (sent, or closed on the server). */
function removeCachedRequest(
  storage: StoragePort,
  userId: string,
  requestId: string,
): void {
  const cached = storage.getCachedFormRequests(userId);
  if (!cached || !cached.requests.some((r) => r.id === requestId)) return;
  storage.cacheFormRequests(userId, {
    ...cached,
    requests: cached.requests.filter((r) => r.id !== requestId),
  });
}

function liveEntries(storage: StoragePort, entityId: string): SyncQueueEntry[] {
  return storage
    .getQueuedEntriesForEntity(FORM_RESPONSE_ENTITY, entityId)
    .filter(isAutoResolvableSyncEntry);
}

/**
 * Send a form with no photos: it waits on this phone ("Waiting to send")
 * and the queue sends it when there's a connection.
 */
export function queueFormResponseCommand(
  deps: AthleteFormsDeps,
  request: AthleteFormRequest,
  draft: Record<string, AnswerValue>,
  answers: Record<string, unknown>,
): LocalFormState {
  const state = update(deps, request, (_s, now) => ({
    answers: draft,
    submittedAt: now,
    sentAt: null,
    rejected: null,
  }));
  const entityId = `${deps.userId}:${request.id}`;
  // A dead row from an earlier send (retries used up, refused for good)
  // goes, so a later Retry on it can't send the form a second time.
  const dead = deps.storage
    .getQueuedEntriesForEntity(FORM_RESPONSE_ENTITY, entityId)
    .filter((e) => e.status !== "completed" && !isAutoResolvableSyncEntry(e))
    .map((e) => e.id);
  if (dead.length > 0) deps.storage.discardEntries(dead);
  // Sent again before an earlier send left the phone: one request, newest
  // answers (the same Idempotency-Key).
  const unsent = liveEntries(deps.storage, entityId).find(
    (e) => e.dispatchCount === 0 && e.status !== "in_flight",
  );
  if (unsent) {
    deps.storage.updateMutationPayload(unsent.id, { answers });
    return state;
  }
  deps.storage.enqueueMutation({
    entityType: FORM_RESPONSE_ENTITY,
    entityId,
    operation: "create",
    payload: { answers },
    endpoint: formResponseEndpoint(request.id),
    method: "POST",
  });
  return state;
}

/** A form sent straight away (photos) was accepted. */
export function recordFormSentCommand(
  deps: AthleteFormsDeps,
  request: AthleteFormRequest,
  draft: Record<string, AnswerValue>,
): void {
  update(deps, request, (_s, now) => ({
    answers: draft,
    submittedAt: now,
    sentAt: now,
    rejected: null,
  }));
  removeCachedRequest(deps.storage, deps.userId, request.id);
}

/** 409 `request_closed` / 404: "This check-in is no longer needed". */
export function recordFormClosedCommand(
  deps: AthleteFormsDeps,
  request: AthleteFormRequest,
): void {
  // A form this phone already sent stays "Sent" (Inspector Brad, #571).
  update(deps, request, (s, now) =>
    s.sentAt !== null
      ? {}
      : { closed: true, submittedAt: s.submittedAt ?? now },
  );
  removeCachedRequest(deps.storage, deps.userId, request.id);
}

/**
 * Requests whose queued response can still reach the server. A row that
 * used up its retries, was refused for good, or was discarded on the
 * sync-failed screen is not here.
 */
export function liveFormResponseIds(
  storage: StoragePort,
  userId: string,
): Set<string> {
  const prefix = `${userId}:`;
  const out = new Set<string>();
  for (const e of storage.getUncompletedMutations()) {
    if (
      e.entityType === FORM_RESPONSE_ENTITY &&
      e.entityId?.startsWith(prefix) &&
      isAutoResolvableSyncEntry(e)
    ) {
      out.add(e.entityId.slice(prefix.length));
    }
  }
  return out;
}

// ── Queue replay ─────────────────────────────────────────────────────────────

function parse(text: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(text) as unknown;
    return typeof v === "object" && v !== null && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function ids(
  entry: SyncQueueEntry,
): { userId: string; requestId: string } | null {
  const [userId, requestId] = (entry.entityId ?? "").split(":");
  return userId && requestId ? { userId, requestId } : null;
}

function patchLocal(
  storage: StoragePort,
  userId: string,
  requestId: string,
  change: Partial<LocalFormState>,
  at: string,
): void {
  const local = storage
    .getLocalFormStates(userId)
    .find((l) => l.requestId === requestId);
  if (!local) return;
  storage.saveLocalFormState(userId, { ...local, ...change, updatedAt: at });
}

/** A queued response reached the server: "Sent 07:58". */
export function applyFormResponseSynced(
  storage: StoragePort,
  entry: SyncQueueEntry,
  now: Date = new Date(),
): void {
  if (entry.entityType !== FORM_RESPONSE_ENTITY) return;
  const id = ids(entry);
  if (!id) return;
  const at = now.toISOString();
  patchLocal(
    storage,
    id.userId,
    id.requestId,
    { sentAt: at, rejected: null },
    at,
  );
  removeCachedRequest(storage, id.userId, id.requestId);
}

/**
 * A queued response the server refused for good. Returns true when it was
 * handled here (the caller resolves the queue row; it is never retried):
 *
 * - 409 `request_closed`, or 404 (the request is gone): closed;
 * - 422 `invalid_answers`: back to "To fill in", with the server's errors.
 */
export function applyFormResponseRefusal(
  storage: StoragePort,
  entry: SyncQueueEntry,
  status: number,
  bodyText: string,
  now: Date = new Date(),
): boolean {
  if (entry.entityType !== FORM_RESPONSE_ENTITY) return false;
  const id = ids(entry);
  if (!id) return false;
  const body = parse(bodyText);
  const at = now.toISOString();
  if (
    (status === 409 && body?.code === "request_closed") ||
    (status === 404 && body?.code === "request_not_found")
  ) {
    // Never "no longer needed" over a send that reached the server: a form
    // already sent stays sent, and "completed" for this phone's own
    // submission means an earlier send of it landed (Inspector Brad, #571).
    const local = storage
      .getLocalFormStates(id.userId)
      .find((l) => l.requestId === id.requestId);
    if (!local?.sentAt) {
      const ours =
        status === 409 &&
        body?.reason === "completed" &&
        local?.submittedAt != null;
      patchLocal(
        storage,
        id.userId,
        id.requestId,
        ours ? { sentAt: at, rejected: null } : { closed: true },
        at,
      );
    }
    removeCachedRequest(storage, id.userId, id.requestId);
    return true;
  }
  if (status === 422 && body?.code === "invalid_answers") {
    patchLocal(
      storage,
      id.userId,
      id.requestId,
      { submittedAt: null, sentAt: null, rejected: { status, json: body } },
      at,
    );
    return true;
  }
  return false;
}

// ── Housekeeping ─────────────────────────────────────────────────────────────

const KEEP_DONE_MS = 14 * 86_400_000;

/**
 * After a fresh list: forget sent or closed forms after two weeks, and
 * drafts of requests the server no longer has (answered elsewhere, or
 * closed). A form still waiting to send is always kept.
 */
export function pruneFormLocals(
  storage: StoragePort,
  userId: string,
  requests: readonly AthleteFormRequest[],
  now: Date = new Date(),
): void {
  const open = new Set(requests.map((r) => r.id));
  const live = liveFormResponseIds(storage, userId);
  for (const local of storage.getLocalFormStates(userId)) {
    const done = local.closed || local.sentAt !== null;
    // Waiting only while its queue row can still send (Inspector Brad,
    // #571); a form whose row died counts as an unsent draft.
    const waiting =
      local.submittedAt !== null && !done && live.has(local.requestId);
    if (waiting) continue;
    const stale = done
      ? now.getTime() - new Date(local.updatedAt).getTime() > KEEP_DONE_MS
      : !open.has(local.requestId);
    if (stale) storage.removeLocalFormState(userId, local.requestId);
  }
}

// ── Sending a form with photos (needs a connection) ──────────────────────────

export type SendNowDeps = AthleteFormsDeps & {
  api: ApiPort;
  /** The photo as a JPEG ready to upload (resized on the phone). */
  readPhoto: (uri: string) => Promise<Blob>;
  newKey: () => string;
};

export type SendNowOutcome =
  | { kind: "sent" }
  | { kind: "closed" }
  | { kind: "invalid"; error: FormResponseSubmit }
  | { kind: "failed"; reason: "photo" | "network" };

/**
 * Upload each photo not uploaded yet (BE-F1 `form_answer`), then send the
 * response, all with keys kept on the phone so a retry never duplicates.
 * Uploaded media ids go into the draft as they arrive, so a retry after a
 * dropped connection doesn't upload them again. An upload key belongs to
 * one picture (field + file), so a retaken photo is a new upload.
 */
export async function sendFormNowCommand(
  deps: SendNowDeps,
  request: AthleteFormRequest,
  draft: Record<string, AnswerValue>,
  photos: readonly { field: string; uri: string }[],
  toApiAnswers: (
    values: Record<string, AnswerValue>,
  ) => Record<string, unknown>,
): Promise<{ outcome: SendNowOutcome; draft: Record<string, AnswerValue> }> {
  const keyFor = (p: { field: string; uri: string }) => `${p.field}|${p.uri}`;
  // One send per form: a queued row for it (dead, or revived on reconnect
  // but not yet sent) goes before this one; one already on its way means
  // try again in a moment (Inspector Brad, #571).
  const queuedRows = deps.storage
    .getQueuedEntriesForEntity(
      FORM_RESPONSE_ENTITY,
      `${deps.userId}:${request.id}`,
    )
    .filter((e) => e.status !== "completed");
  if (queuedRows.some((e) => e.status === "in_flight")) {
    return { outcome: { kind: "failed", reason: "network" }, draft };
  }
  if (queuedRows.length > 0) {
    deps.storage.discardEntries(queuedRows.map((e) => e.id));
  }
  const keys = ensureSubmitKeysCommand(
    deps,
    request,
    photos.map(keyFor),
    deps.newKey,
  );
  let values = { ...draft };
  const failed = (reason: "photo" | "network") => ({
    outcome: { kind: "failed" as const, reason },
    draft: values,
  });
  for (const photo of photos) {
    let blob: Blob;
    try {
      blob = await deps.readPhoto(photo.uri);
    } catch {
      return failed("photo");
    }
    const created = await deps.api.createFormAnswerUpload(
      blob.size,
      keys.uploadKeys[keyFor(photo)]!,
    );
    if (!created.ok) return failed("network");
    if (created.value.upload) {
      const put = await deps.api.putPresignedUpload(created.value.upload, blob);
      if (!put.ok) return failed("network");
    }
    values = {
      ...values,
      [photo.field]: { uri: photo.uri, mediaId: created.value.mediaId },
    };
    saveFormDraftCommand(deps, request, values, keys.step);
  }

  const sent = await deps.api.submitFormResponse(
    request.id,
    toApiAnswers(values),
    keys.submitKey!,
  );
  if (!sent.ok) return failed("network");
  const { status, json } = sent.value;
  const code =
    typeof json === "object" && json !== null
      ? (json as { code?: unknown }).code
      : undefined;
  if (status >= 200 && status < 300) {
    recordFormSentCommand(deps, request, values);
    return { outcome: { kind: "sent" }, draft: values };
  }
  if (
    (status === 409 && code === "request_closed") ||
    (status === 404 && code === "request_not_found")
  ) {
    recordFormClosedCommand(deps, request);
    return { outcome: { kind: "closed" }, draft: values };
  }
  if (status === 422) {
    return { outcome: { kind: "invalid", error: sent.value }, draft: values };
  }
  return failed("network");
}
