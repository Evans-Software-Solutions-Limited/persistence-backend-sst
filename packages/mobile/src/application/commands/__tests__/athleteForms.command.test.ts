/**
 * PER-130 — the athlete's form responses offline, and their replay through
 * the queue. The fake server behaves like the BE-C1 route: a response is
 * idempotent on `Idempotency-Key` (a replay returns the stored one), 409
 * `request_closed` when the request is cancelled or missed for over 7 days,
 * 422 `invalid_answers` with `errors[].at` = question id.
 */
import { processSyncQueue } from "../sync.command";
import {
  FORM_RESPONSE_ENTITY,
  applyFormResponseRefusal,
  applyFormResponseSynced,
  ensureSubmitKeysCommand,
  formResponseEndpoint,
  liveFormResponseIds,
  localStateFor,
  markJoinIntroSeenCommand,
  pruneFormLocals,
  queueFormResponseCommand,
  recordFormClosedCommand,
  recordFormSentCommand,
  saveFormDraftCommand,
  sendFormNowCommand,
} from "../athleteForms.command";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import { InMemoryAuthAdapter } from "@/adapters/auth/__tests__/in-memory-auth.adapter";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import type {
  AthleteFormRequest,
  LocalFormState,
} from "@/domain/models/athleteForms";
import type { SyncQueueEntry } from "@/domain/ports/storage.port";
import { fail, ok } from "@/shared/errors";
import {
  coachFormsView,
  isWaiting,
  withLiveQueue,
} from "@/domain/services/athleteForms.service";

jest.mock("@/lib/sentry", () => ({ captureSyncFailure: jest.fn() }));

const BASE = "https://api.test";
const USER = "athlete-1";
const NOW = new Date("2026-11-26T09:00:00Z");
const deps = () => ({ storage, userId: USER, now: () => NOW });

function request(
  id: string,
  extra: Partial<AthleteFormRequest> = {},
): AthleteFormRequest {
  return {
    id,
    formId: `form-${id}`,
    title: "Weekly check-in",
    description: null,
    coach: { id: "coach-ellie", name: "Ellie Hart" },
    trigger: "weekly",
    periodKey: "2026-W48",
    sentAt: "2026-11-23T09:00:00Z",
    dueAt: "2026-11-27T12:00:00Z",
    closesAt: null,
    status: "pending",
    late: false,
    version: {
      id: `v-${id}`,
      version: 1,
      questions: [
        { id: "energy", type: "scale", prompt: "Energy", required: true },
      ],
    },
    ...extra,
  };
}

class FakeServer {
  responses = new Map<string, { key: string; answers: unknown }>();
  closed = new Set<string>();
  invalid = new Set<string>();
  calls: { url: string; key?: string; body: unknown }[] = [];
  offline = false;
  /** Answer every response POST with this status (no body code). */
  forceStatus: number | null = null;

  fetch = async (
    url: string,
    init: { method: string; headers: Record<string, string>; body?: string },
  ) => {
    const key = init.headers["Idempotency-Key"];
    const body = init.body ? (JSON.parse(init.body) as unknown) : null;
    this.calls.push({ url, key, body });
    if (this.offline) throw new TypeError("Network request failed");
    const id = /form-requests\/([^/]+)\/response$/.exec(url)?.[1] ?? "";
    const reply = (status: number, json: unknown) => ({
      ok: status >= 200 && status < 300,
      status,
      text: async () => JSON.stringify(json),
      json: async () => json,
    });
    if (this.forceStatus !== null) {
      return reply(this.forceStatus, { message: "nope" });
    }
    const stored = this.responses.get(id);
    if (stored && stored.key === key) return reply(201, { data: { id: "r" } });
    if (this.closed.has(id) || stored) {
      return reply(409, {
        code: "request_closed",
        reason: stored ? "completed" : "cancelled",
        message: "This check-in is no longer needed",
      });
    }
    if (this.invalid.has(id)) {
      return reply(422, {
        code: "invalid_answers",
        message: "Some answers aren't valid",
        errors: [{ at: "energy", message: "must be a whole number 1–5" }],
      });
    }
    this.responses.set(id, {
      key: key ?? "",
      answers: (body as { answers: unknown }).answers,
    });
    return reply(201, { data: { id: "r" } });
  };
}

let storage: InMemoryStorageAdapter;
let auth: InMemoryAuthAdapter;
let server: FakeServer;
let clock = Date.now();
const drain = () =>
  processSyncQueue(storage, auth, BASE, { now: () => (clock += 10 * 60_000) });
const queued = () => storage.getUncompletedMutations();
const local = (id: string) =>
  storage.getLocalFormStates(USER).find((l) => l.requestId === id);

beforeEach(async () => {
  storage = new InMemoryStorageAdapter();
  await storage.initialize();
  auth = new InMemoryAuthAdapter();
  server = new FakeServer();
  (globalThis as Record<string, unknown>).fetch = jest.fn(server.fetch);
  storage.cacheFormRequests(USER, {
    requests: [request("req-1"), request("req-2")],
    asOf: "a",
  });
});

describe("drafts", () => {
  it("saves the answers and the question shown, keeping what it knew", () => {
    const r = request("req-1");
    saveFormDraftCommand(deps(), r, { q0: 4 }, 0);
    markJoinIntroSeenCommand(deps(), [r]);
    saveFormDraftCommand(deps(), r, { q0: 5 }, 1);
    expect(local("req-1")).toMatchObject({
      title: "Weekly check-in",
      coachId: "coach-ellie",
      trigger: "weekly",
      answers: { q0: 5 },
      step: 1,
      introSeen: true,
      submittedAt: null,
      updatedAt: NOW.toISOString(),
    });
  });

  it("a fresh state for a request it hasn't seen", () => {
    expect(localStateFor(storage, USER, request("new"), "t")).toMatchObject({
      requestId: "new",
      answers: {},
      step: 0,
      closed: false,
      uploadKeys: {},
    });
  });

  it("keeps idempotency keys once made", () => {
    let n = 0;
    const key = () => `k${++n}`;
    const r = request("req-1");
    const first = ensureSubmitKeysCommand(deps(), r, ["q1|a"], key);
    const again = ensureSubmitKeysCommand(deps(), r, ["q1|a", "q2|b"], key);
    expect(first.submitKey).toBe("k2");
    expect(again.submitKey).toBe("k2");
    expect(again.uploadKeys).toEqual({ "q1|a": "k1", "q2|b": "k3" });
  });
});

describe("offline send → replay (Idempotency-Key)", () => {
  it("waits on the phone, then sends once and drops off the list", async () => {
    server.offline = true;
    queueFormResponseCommand(
      deps(),
      request("req-1"),
      { q0: 4 },
      { energy: 4 },
    );
    expect(local("req-1")).toMatchObject({
      submittedAt: NOW.toISOString(),
      sentAt: null,
    });
    expect(queued()).toHaveLength(1);
    expect(queued()[0]).toMatchObject({
      entityType: FORM_RESPONSE_ENTITY,
      entityId: `${USER}:req-1`,
      method: "POST",
      endpoint: formResponseEndpoint("req-1"),
    });
    expect(JSON.parse(queued()[0]!.payload)).toEqual({
      answers: { energy: 4 },
    });

    await drain(); // offline: still waiting
    expect(queued()).toHaveLength(1);
    expect(local("req-1")?.sentAt).toBeNull();

    server.offline = false;
    await drain();
    expect(queued()).toHaveLength(0);
    expect(server.responses.get("req-1")?.answers).toEqual({ energy: 4 });
    expect(server.calls.every((c) => c.key === server.calls[0]!.key)).toBe(
      true,
    );
    expect(server.calls[0]!.key).toBeTruthy();
    expect(local("req-1")?.sentAt).not.toBeNull();
    expect(
      storage.getCachedFormRequests(USER)?.requests.map((r) => r.id),
    ).toEqual(["req-2"]);
  });

  it("sending again before it left the phone sends the newest answers once", async () => {
    server.offline = true;
    queueFormResponseCommand(deps(), request("req-1"), {}, { energy: 2 });
    queueFormResponseCommand(deps(), request("req-1"), {}, { energy: 3 });
    expect(queued()).toHaveLength(1);
    server.offline = false;
    await drain();
    expect(server.responses.get("req-1")?.answers).toEqual({ energy: 3 });
  });

  it("a replay after a lost reply is the stored response, not a second one", async () => {
    queueFormResponseCommand(deps(), request("req-1"), {}, { energy: 4 });
    const key = queued()[0]!.idempotencyKey!;
    server.responses.set("req-1", { key, answers: { energy: 4 } });
    await drain();
    expect(queued()).toHaveLength(0);
    expect(local("req-1")?.sentAt).not.toBeNull();
    expect(local("req-1")?.closed).toBe(false);
  });

  it("409 request_closed: 'no longer needed', never retried", async () => {
    server.closed.add("req-1");
    queueFormResponseCommand(deps(), request("req-1"), {}, { energy: 4 });
    await drain();
    expect(queued()).toHaveLength(0);
    expect(local("req-1")?.closed).toBe(true);
    expect(
      storage.getCachedFormRequests(USER)?.requests.map((r) => r.id),
    ).toEqual(["req-2"]);
  });

  it("422 invalid_answers: back to the form with the server's errors", async () => {
    server.invalid.add("req-1");
    queueFormResponseCommand(
      deps(),
      request("req-1"),
      { q0: 9 },
      { energy: 9 },
    );
    await drain();
    expect(queued()).toHaveLength(0);
    const l = local("req-1")!;
    expect(l.submittedAt).toBeNull();
    expect(l.rejected).toMatchObject({
      status: 422,
      json: { code: "invalid_answers", errors: [{ at: "energy" }] },
    });
    // Still cached, so it shows under "To fill in" again.
    expect(storage.getCachedFormRequests(USER)?.requests).toHaveLength(2);

    // Sending again clears the rejection and queues afresh.
    queueFormResponseCommand(
      deps(),
      request("req-1"),
      { q0: 4 },
      { energy: 4 },
    );
    expect(local("req-1")?.rejected).toBeNull();
    expect(queued()).toHaveLength(1);
  });
});

describe("queue hooks", () => {
  const entry = (extra: Partial<SyncQueueEntry> = {}): SyncQueueEntry =>
    ({
      id: 1,
      entityType: FORM_RESPONSE_ENTITY,
      entityId: `${USER}:req-1`,
      ...extra,
    }) as SyncQueueEntry;

  beforeEach(() => {
    queueFormResponseCommand(deps(), request("req-1"), {}, { energy: 4 });
  });

  it("ignore other entities and malformed ids", () => {
    expect(
      applyFormResponseRefusal(storage, entry({ entityType: "x" }), 409, "{}"),
    ).toBe(false);
    expect(
      applyFormResponseRefusal(storage, entry({ entityId: "nope" }), 409, "{}"),
    ).toBe(false);
    applyFormResponseSynced(storage, entry({ entityType: "x" }));
    applyFormResponseSynced(storage, entry({ entityId: null }));
    expect(local("req-1")?.sentAt).toBeNull();
  });

  it("leave other refusals to the drain's ordinary failure path", () => {
    expect(applyFormResponseRefusal(storage, entry(), 500, "oops")).toBe(false);
    expect(
      applyFormResponseRefusal(storage, entry(), 409, '{"code":"other"}'),
    ).toBe(false);
    expect(applyFormResponseRefusal(storage, entry(), 422, "not json")).toBe(
      false,
    );
  });

  it("404 request_not_found counts as closed", () => {
    expect(
      applyFormResponseRefusal(
        storage,
        entry(),
        404,
        '{"code":"request_not_found"}',
      ),
    ).toBe(true);
    expect(local("req-1")?.closed).toBe(true);
  });

  it("a hook for a request with no local state changes nothing", () => {
    applyFormResponseSynced(storage, entry({ entityId: `${USER}:ghost` }));
    expect(local("ghost")).toBeUndefined();
  });
});

describe("a send that can no longer go comes back to fill in (Inspector Brad, #571)", () => {
  /** What the Coach tab sees for req-1 right now. */
  const seen = () => {
    const locals = withLiveQueue(
      storage.getLocalFormStates(USER),
      liveFormResponseIds(storage, USER),
    );
    const view = coachFormsView({
      requests: storage.getCachedFormRequests(USER)!.requests,
      locals,
      coachId: "coach-ellie",
      now: NOW,
    });
    return {
      waiting: isWaiting(locals.find((l) => l.requestId === "req-1")),
      toFill: view.toFill.map((c) => c.requestId),
      started: view.toFill.find((c) => c.requestId === "req-1")?.started,
    };
  };

  beforeEach(() => {
    queueFormResponseCommand(
      deps(),
      request("req-1"),
      { q0: 4 },
      { energy: 4 },
    );
    expect(seen()).toMatchObject({ waiting: true, toFill: ["req-2"] });
  });

  it("retries used up (5xx three times)", async () => {
    server.forceStatus = 500;
    await drain();
    await drain();
    await drain();
    await drain();
    expect(liveFormResponseIds(storage, USER).size).toBe(0);
    expect(seen()).toEqual({
      waiting: false,
      toFill: ["req-1", "req-2"],
      started: true,
    });
  });

  it("403 until retries run out", async () => {
    server.forceStatus = 403;
    for (let i = 0; i < 4; i++) await drain();
    expect(seen()).toMatchObject({
      waiting: false,
      toFill: ["req-1", "req-2"],
    });
  });

  it("refused for good (400 → permanently failed)", async () => {
    server.forceStatus = 400;
    await drain();
    expect(liveFormResponseIds(storage, USER).size).toBe(0);
    expect(seen()).toMatchObject({
      waiting: false,
      toFill: ["req-1", "req-2"],
    });
  });

  it("discarded on the sync-failed screen", () => {
    storage.discardEntries(queued().map((e) => e.id));
    expect(seen()).toMatchObject({
      waiting: false,
      toFill: ["req-1", "req-2"],
      started: true,
    });
  });

  it("sending it again drops the dead row and sends once", async () => {
    server.forceStatus = 400;
    await drain();
    server.forceStatus = null;
    queueFormResponseCommand(
      deps(),
      request("req-1"),
      { q0: 5 },
      { energy: 5 },
    );
    expect(queued()).toHaveLength(1);
    expect(seen().waiting).toBe(true);
    await drain();
    expect(server.responses.get("req-1")?.answers).toEqual({ energy: 5 });
    expect(local("req-1")?.sentAt).not.toBeNull();
  });

  it("prune forgets a dead send once the server no longer lists it", () => {
    storage.discardEntries(queued().map((e) => e.id));
    pruneFormLocals(storage, USER, [request("req-2")], NOW);
    expect(local("req-1")).toBeUndefined();
  });

  it("prune keeps a send that can still go", () => {
    pruneFormLocals(storage, USER, [], NOW);
    expect(local("req-1")).toBeDefined();
  });
});

describe("a 409 never marks a sent form 'no longer needed' (Inspector Brad, #571)", () => {
  const entry = {
    id: 1,
    entityType: FORM_RESPONSE_ENTITY,
    entityId: `${USER}:req-1`,
  } as SyncQueueEntry;

  it("already sent: stays sent", () => {
    recordFormSentCommand(deps(), request("req-1"), { q0: 4 });
    expect(
      applyFormResponseRefusal(
        storage,
        entry,
        409,
        '{"code":"request_closed","reason":"cancelled"}',
      ),
    ).toBe(true);
    expect(local("req-1")).toMatchObject({ closed: false });
    expect(local("req-1")?.sentAt).not.toBeNull();
    recordFormClosedCommand(deps(), request("req-1"));
    expect(local("req-1")?.closed).toBe(false);
  });

  it("'completed' for this phone's own submission counts as sent", () => {
    queueFormResponseCommand(deps(), request("req-1"), {}, { energy: 4 });
    applyFormResponseRefusal(
      storage,
      entry,
      409,
      '{"code":"request_closed","reason":"completed"}',
      NOW,
    );
    expect(local("req-1")).toMatchObject({
      closed: false,
      sentAt: NOW.toISOString(),
    });
  });

  it("'cancelled' still says no longer needed", () => {
    queueFormResponseCommand(deps(), request("req-1"), {}, { energy: 4 });
    applyFormResponseRefusal(
      storage,
      entry,
      409,
      '{"code":"request_closed","reason":"cancelled"}',
    );
    expect(local("req-1")?.closed).toBe(true);
  });

  it("end to end: a second send after the first landed doesn't close it", async () => {
    // The first send landed but its reply was lost; the server has it.
    queueFormResponseCommand(deps(), request("req-1"), {}, { energy: 4 });
    server.responses.set("req-1", { key: "other-key", answers: { energy: 4 } });
    await drain();
    expect(local("req-1")).toMatchObject({ closed: false });
    expect(local("req-1")?.sentAt).not.toBeNull();
  });
});

describe("recorded outcomes and housekeeping", () => {
  it("sent and closed both leave the cached list", () => {
    recordFormSentCommand(deps(), request("req-1"), { q0: 4 });
    recordFormClosedCommand(deps(), request("req-2"));
    expect(local("req-1")).toMatchObject({
      sentAt: NOW.toISOString(),
      submittedAt: NOW.toISOString(),
    });
    expect(local("req-2")).toMatchObject({
      closed: true,
      submittedAt: NOW.toISOString(),
    });
    expect(storage.getCachedFormRequests(USER)?.requests).toEqual([]);
    // Nothing cached at all: still fine.
    const empty = new InMemoryStorageAdapter();
    recordFormClosedCommand({ storage: empty, userId: USER }, request("x"));
    expect(empty.getCachedFormRequests(USER)).toBeNull();
  });

  it("prunes old done forms and orphaned drafts, keeps what's waiting", () => {
    const base = localStateFor(storage, USER, request("a"), "");
    const put = (id: string, change: Partial<LocalFormState>) =>
      storage.saveLocalFormState(USER, { ...base, requestId: id, ...change });
    put("old-sent", {
      sentAt: "2026-11-01T00:00:00Z",
      updatedAt: "2026-11-01T00:00:00Z",
    });
    put("new-sent", {
      sentAt: "2026-11-25T00:00:00Z",
      updatedAt: "2026-11-25T00:00:00Z",
    });
    put("old-closed", { closed: true, updatedAt: "2026-11-01T00:00:00Z" });
    put("waiting", {
      submittedAt: "2026-11-01T00:00:00Z",
      updatedAt: "2026-11-01T00:00:00Z",
    });
    // Its queue row can still send.
    storage.enqueueMutation({
      entityType: FORM_RESPONSE_ENTITY,
      entityId: `${USER}:waiting`,
      operation: "create",
      payload: { answers: {} },
      endpoint: formResponseEndpoint("waiting"),
      method: "POST",
    });
    put("orphan-draft", { updatedAt: "2026-11-25T00:00:00Z" });
    put("req-1", { updatedAt: "2026-11-01T00:00:00Z" });
    pruneFormLocals(storage, USER, [request("req-1")], NOW);
    expect(
      storage
        .getLocalFormStates(USER)
        .map((l) => l.requestId)
        .sort(),
    ).toEqual(["new-sent", "req-1", "waiting"]);
  });
});

describe("sendFormNowCommand (photos need a connection)", () => {
  const photoRequest = request("req-p", {
    version: {
      id: "v",
      version: 1,
      questions: [
        { id: "front", type: "photo", prompt: "Front", required: true },
        { id: "note", type: "short_text", prompt: "Note", required: false },
      ],
    },
  });
  const blob = { size: 1234 } as Blob;
  const toApi = (v: Record<string, unknown>) => {
    const p = v.q0 as { mediaId: string | null };
    return { front: { mediaId: p.mediaId } };
  };
  let api: InMemoryApiAdapter;
  let n = 0;
  const sendDeps = (readPhoto = async () => blob) => ({
    ...deps(),
    api,
    readPhoto,
    newKey: () => `key-${++n}`,
  });
  const draft = { q0: { uri: "file://front.jpg", mediaId: null }, q1: "" };
  const photos = [{ field: "q0", uri: "file://front.jpg" }];

  beforeEach(() => {
    api = new InMemoryApiAdapter();
    n = 0;
  });

  it("uploads, puts the file, then sends with the media id", async () => {
    const { outcome, draft: after } = await sendFormNowCommand(
      sendDeps(),
      photoRequest,
      draft,
      photos,
      toApi,
    );
    expect(outcome).toEqual({ kind: "sent" });
    expect(api.createFormAnswerUploadCalls).toEqual([
      { bytes: 1234, idempotencyKey: "key-1" },
    ]);
    expect(api.putPresignedUploadCalls).toEqual([
      { url: "https://bucket.example/1", size: 1234 },
    ]);
    expect(api.submitFormResponseCalls).toEqual([
      {
        requestId: "req-p",
        answers: { front: { mediaId: "media-1" } },
        idempotencyKey: "key-2",
      },
    ]);
    expect(after.q0).toEqual({ uri: "file://front.jpg", mediaId: "media-1" });
    expect(local("req-p")?.sentAt).toBe(NOW.toISOString());
  });

  it("a ready upload (replay) isn't put again", async () => {
    api.formUploadResults.push(
      ok({ mediaId: "m-ready", status: "ready", upload: null }),
    );
    const { outcome } = await sendFormNowCommand(
      sendDeps(),
      photoRequest,
      draft,
      photos,
      toApi,
    );
    expect(outcome.kind).toBe("sent");
    expect(api.putPresignedUploadCalls).toEqual([]);
  });

  it("an unreadable photo, a failed upload or PUT, or no connection: failed, draft kept", async () => {
    const bad = await sendFormNowCommand(
      sendDeps(async () => {
        throw new Error("gone");
      }),
      photoRequest,
      draft,
      photos,
      toApi,
    );
    expect(bad.outcome).toEqual({ kind: "failed", reason: "photo" });

    api.formUploadResults.push(
      fail({ kind: "api", code: "network", message: "x" }),
    );
    expect(
      (await sendFormNowCommand(sendDeps(), photoRequest, draft, photos, toApi))
        .outcome,
    ).toEqual({ kind: "failed", reason: "network" });

    api.putPresignedUploadResults.push(
      fail({ kind: "api", code: "server", message: "x" }),
    );
    expect(
      (await sendFormNowCommand(sendDeps(), photoRequest, draft, photos, toApi))
        .outcome,
    ).toEqual({ kind: "failed", reason: "network" });

    api.submitFormResponseResults.push(
      fail({ kind: "api", code: "network", message: "x" }),
    );
    const lost = await sendFormNowCommand(
      sendDeps(),
      photoRequest,
      draft,
      photos,
      toApi,
    );
    expect(lost.outcome).toEqual({ kind: "failed", reason: "network" });
    // The photo uploaded: its media id is in the draft for the retry.
    expect(lost.draft.q0).toEqual({
      uri: "file://front.jpg",
      mediaId: "media-3",
    });
    expect(local("req-p")?.answers.q0).toEqual({
      uri: "file://front.jpg",
      mediaId: "media-3",
    });
    // The same submit key every time.
    expect(
      new Set(api.submitFormResponseCalls.map((c) => c.idempotencyKey)).size,
    ).toBe(1);
  });

  it("409 request_closed and 404 → closed; 422 → invalid; other → failed", async () => {
    api.submitFormResponseResults.push(
      ok({ status: 409, json: { code: "request_closed" } }),
    );
    expect(
      (await sendFormNowCommand(sendDeps(), photoRequest, draft, photos, toApi))
        .outcome,
    ).toEqual({ kind: "closed" });
    expect(local("req-p")?.closed).toBe(true);

    api.submitFormResponseResults.push(
      ok({ status: 404, json: { code: "request_not_found" } }),
    );
    expect(
      (await sendFormNowCommand(sendDeps(), photoRequest, draft, photos, toApi))
        .outcome.kind,
    ).toBe("closed");

    const body = {
      code: "invalid_answers",
      errors: [{ at: "front", message: "x" }],
    };
    api.submitFormResponseResults.push(ok({ status: 422, json: body }));
    expect(
      (await sendFormNowCommand(sendDeps(), photoRequest, draft, photos, toApi))
        .outcome,
    ).toEqual({ kind: "invalid", error: { status: 422, json: body } });

    api.submitFormResponseResults.push(ok({ status: 500, json: null }));
    expect(
      (await sendFormNowCommand(sendDeps(), photoRequest, draft, photos, toApi))
        .outcome,
    ).toEqual({ kind: "failed", reason: "network" });
  });
});
