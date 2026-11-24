/**
 * PER-129 — coach forms writes offline and their replay through the queue.
 *
 * The fake server behaves like the PER-116/129 backend: form and send-rule
 * creates are idempotent on `Idempotency-Key`; PATCHes check
 * `expectedRevision` and answer 409 `revision_conflict` with `current`;
 * per-client setup is a plain PUT; review is idempotent.
 */
import { processSyncQueue } from "../sync.command";
import {
  COACH_FORM_ENTITY,
  COACH_FORM_SCHEDULE_ENTITY,
  applyCoachFormsConflict,
  applyCoachFormsSyncSuccess,
  reconcileClientForms,
  reconcileCoachFormSchedules,
  reconcileCoachForms,
  reconcileResponses,
  resolveCoachFormsId,
  reviewResponseCommand,
  saveFormCommand,
  saveScheduleCommand,
  setClientFormSetupCommand,
} from "../coachForms.command";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import { InMemoryAuthAdapter } from "@/adapters/auth/__tests__/in-memory-auth.adapter";
import type {
  ClientForm,
  CoachForm,
  FormResponse,
  FormSchedule,
  Question,
} from "@/domain/models/coachForms";

jest.mock("@/lib/sentry", () => ({ captureSyncFailure: jest.fn() }));

const BASE = "https://api.test";
const USER = "coach-1";
const deps = () => ({ storage, userId: USER });
const Q = (id: string, prompt = id): Question => ({
  id,
  type: "short_text",
  prompt,
  required: true,
});

class FakeServer {
  forms: CoachForm[] = [];
  schedules: FormSchedule[] = [];
  keys = new Map<string, string>();
  setups: { clientId: string; formId: string; body: unknown }[] = [];
  reviews = new Map<string, { reviewedAt: string; replyText: string | null }>();
  calls: {
    url: string;
    method: string;
    body: Record<string, unknown>;
    key?: string;
  }[] = [];
  offline = false;
  loseNextResponse = false;
  private seq = 0;

  fetch = async (
    url: string,
    init: { method: string; headers: Record<string, string>; body?: string },
  ) => {
    const body = init.body
      ? (JSON.parse(init.body) as Record<string, unknown>)
      : {};
    const key = init.headers["Idempotency-Key"];
    this.calls.push({ url, method: init.method, body, key });
    if (this.offline) throw new TypeError("Network request failed");
    const reply = (status: number, json: unknown) => {
      if (this.loseNextResponse) {
        this.loseNextResponse = false;
        throw new TypeError("Network request failed");
      }
      return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => json,
        text: async () => JSON.stringify(json),
      };
    };
    const path = url.slice(BASE.length);

    if (path === "/trainers/me/forms" && init.method === "POST") {
      const existing = key ? this.keys.get(key) : undefined;
      if (existing) {
        return reply(201, { data: this.forms.find((f) => f.id === existing) });
      }
      if (typeof body.title !== "string" || !Array.isArray(body.questions)) {
        return reply(422, { code: "invalid_form" });
      }
      const id = `f-${++this.seq}`;
      const form = serverForm(id, body.title, body.questions as Question[], 1);
      this.forms.push(form);
      if (key) this.keys.set(key, id);
      return reply(201, { data: form });
    }
    let m = /^\/trainers\/me\/forms\/([^/]+)$/.exec(path);
    if (m && init.method === "PATCH") {
      const form = this.forms.find((f) => f.id === m![1]);
      if (!form) return reply(422, { code: "invalid_id" });
      if (body.expectedRevision !== form.revision) {
        return reply(409, {
          code: "revision_conflict",
          message: "x",
          current: form,
        });
      }
      form.revision += 1;
      if (typeof body.title === "string") form.title = body.title;
      if (Array.isArray(body.questions)) {
        form.version = {
          id: `${form.id}-v${form.revision}`,
          version: (form.version?.version ?? 0) + 1,
          createdAt: "2026-11-24T00:00:00Z",
          questions: body.questions as Question[],
        };
      }
      return reply(200, { data: form });
    }
    if (path === "/trainers/me/form-schedules" && init.method === "POST") {
      const existing = key ? this.keys.get(key) : undefined;
      if (existing) {
        return reply(201, {
          data: this.schedules.find((s) => s.id === existing),
        });
      }
      if (!this.forms.some((f) => f.id === body.formId)) {
        return reply(422, { code: "invalid_id" });
      }
      const id = `s-${++this.seq}`;
      const s: FormSchedule = {
        id,
        formId: body.formId as string,
        trigger: body.trigger as FormSchedule["trigger"],
        audience: body.audience as FormSchedule["audience"],
        weekday: (body.weekday as number) ?? null,
        timeLocal: (body.timeLocal as string) ?? null,
        dueAfterHours: (body.dueAfterHours as number) ?? null,
        reminders: (body.reminders as { afterHours: number }[]) ?? [],
        status: "active",
        revision: 1,
        clients: [],
        createdAt: "2026-11-24T00:00:00Z",
        updatedAt: "2026-11-24T00:00:00Z",
      };
      this.schedules.push(s);
      if (key) this.keys.set(key, id);
      return reply(201, { data: s });
    }
    m = /^\/trainers\/me\/form-schedules\/([^/]+)$/.exec(path);
    if (m && init.method === "PATCH") {
      const s = this.schedules.find((x) => x.id === m![1]);
      if (!s) return reply(422, { code: "invalid_id" });
      if (body.expectedRevision !== s.revision) {
        return reply(409, { code: "revision_conflict", current: s });
      }
      s.revision += 1;
      if (typeof body.status === "string")
        s.status = body.status as FormSchedule["status"];
      if (body.timeLocal !== undefined) s.timeLocal = body.timeLocal as string;
      return reply(200, { data: s });
    }
    m = /^\/trainers\/me\/clients\/([^/]+)\/forms\/([^/]+)\/setup$/.exec(path);
    if (m && init.method === "PUT") {
      this.setups.push({ clientId: m[1]!, formId: m[2]!, body });
      const dto: ClientForm | null =
        body.status === "excluded"
          ? null
          : {
              form: { id: m[2]!, title: "Server title", archivedAt: null },
              rule: null,
              rules: [],
              lastDoneAt: null,
              lastSentAt: null,
              pendingRequestId: null,
              state: body.status === "paused" ? "paused" : "notDoneYet",
            };
      return reply(200, { data: dto });
    }
    m =
      /^\/trainers\/me\/clients\/([^/]+)\/form-responses\/([^/]+)\/review$/.exec(
        path,
      );
    if (m && init.method === "POST") {
      const prior = this.reviews.get(m[2]!);
      const next = {
        reviewedAt: prior?.reviewedAt ?? "2026-11-24T10:00:00Z",
        replyText:
          body.replyText !== undefined
            ? (body.replyText as string) || null
            : (prior?.replyText ?? null),
      };
      this.reviews.set(m[2]!, next);
      return reply(200, { data: { ...response(m[2]!), ...next } });
    }
    return reply(404, { error: "not_found" });
  };
}

function serverForm(
  id: string,
  title: string,
  questions: Question[],
  revision: number,
): CoachForm {
  return {
    id,
    title,
    description: null,
    templateKey: null,
    available: true,
    revision,
    archivedAt: null,
    createdAt: "2026-11-24T00:00:00Z",
    updatedAt: "2026-11-24T00:00:00Z",
    version: { id: `${id}-v1`, version: 1, createdAt: "x", questions },
  };
}

function response(id: string, extra: Partial<FormResponse> = {}): FormResponse {
  return {
    id,
    requestId: `req-${id}`,
    formId: "f-1",
    title: "Weekly check-in",
    trigger: "weekly",
    periodKey: "w",
    sentAt: "2026-11-23T09:00:00Z",
    submittedAt: "2026-11-23T10:00:00Z",
    late: false,
    answers: {},
    reviewedAt: null,
    replyText: null,
    version: { id: "v", version: 1, questions: [] },
    ...extra,
  };
}

let storage: InMemoryStorageAdapter;
let auth: InMemoryAuthAdapter;
let server: FakeServer;

// Each drain runs 10 minutes later, past any backoff window.
let clock = Date.now();
const drain = () =>
  processSyncQueue(storage, auth, BASE, { now: () => (clock += 10 * 60_000) });
const queued = () => storage.getUncompletedMutations();

beforeEach(async () => {
  storage = new InMemoryStorageAdapter();
  await storage.initialize();
  auth = new InMemoryAuthAdapter();
  server = new FakeServer();
  (globalThis as Record<string, unknown>).fetch = jest.fn(server.fetch);
});

/** A form that already exists on the server and in the cache. */
function seedForm(id = "f-1", revision = 3): CoachForm {
  const form = serverForm(id, "Weekly check-in", [Q("q1", "Energy")], revision);
  server.forms.push(JSON.parse(JSON.stringify(form)) as CoachForm);
  storage.cacheCoachForms(USER, { forms: [form], templates: [], asOf: "a" });
  return form;
}

describe("form create offline → replay (Idempotency-Key)", () => {
  it("caches a local form, queues one keyed POST, and swaps to the server id on sync", async () => {
    server.offline = true;
    const local = saveFormCommand(deps(), {
      title: " Weekly check-in ",
      description: " ",
      questions: [Q("q1", " Energy ")],
    });
    expect(local.id).toMatch(/^local-/);
    expect(storage.getCachedCoachForms(USER)?.forms[0]?.title).toBe(
      "Weekly check-in",
    );
    expect(queued()).toHaveLength(1);
    expect(queued()[0]).toMatchObject({
      entityType: COACH_FORM_ENTITY,
      method: "POST",
      endpoint: "/trainers/me/forms",
    });
    expect(JSON.parse(queued()[0]!.payload)).toEqual({
      title: "Weekly check-in",
      description: null,
      questions: [
        { id: "q1", type: "short_text", prompt: "Energy", required: true },
      ],
    });

    await drain(); // offline: deferred, still queued
    expect(queued()).toHaveLength(1);
    expect(server.forms).toHaveLength(0);

    server.offline = false;
    await drain();
    expect(server.forms).toHaveLength(1);
    expect(server.calls.at(-1)?.key).toBeTruthy();
    expect(queued()).toHaveLength(0);
    const cached = storage.getCachedCoachForms(USER)!.forms;
    expect(cached.map((f) => f.id)).toEqual(["f-1"]);
    expect(cached[0]!.revision).toBe(1);
    expect(resolveCoachFormsId(local.id)).toBe("f-1");
  });

  it("a lost reply re-sends the same key and makes no second form", async () => {
    saveFormCommand(deps(), {
      title: "A",
      description: null,
      questions: [Q("q1")],
    });
    server.loseNextResponse = true;
    await drain();
    expect(server.forms).toHaveLength(1);
    expect(queued()).toHaveLength(1);
    await drain();
    expect(server.forms).toHaveLength(1);
    const keys = server.calls.map((c) => c.key);
    expect(keys[0]).toBe(keys[1]);
    expect(storage.getCachedCoachForms(USER)!.forms.map((f) => f.id)).toEqual([
      "f-1",
    ]);
  });

  it("an edit before the create is sent folds into it (one POST)", async () => {
    server.offline = true;
    const local = saveFormCommand(deps(), {
      title: "A",
      description: null,
      questions: [Q("q1")],
    });
    saveFormCommand(deps(), {
      id: local.id,
      title: "B",
      description: "about",
      questions: [Q("q1"), Q("q2")],
    });
    expect(queued()).toHaveLength(1);
    server.offline = false;
    await drain();
    expect(server.forms[0]?.title).toBe("B");
    expect(server.forms[0]?.version?.questions).toHaveLength(2);
    expect(server.calls.filter((c) => c.method === "PATCH")).toHaveLength(0);
  });

  it("an edit while the create is on its way PATCHes the server id with its new revision", async () => {
    const local = saveFormCommand(deps(), {
      title: "A",
      description: null,
      questions: [Q("q1")],
    });
    storage.markMutationDispatched(queued()[0]!.id); // the create has been sent once
    saveFormCommand(deps(), {
      id: local.id,
      title: "B",
      description: null,
      questions: [Q("q1")],
    });
    const patch = queued()[1]!;
    expect(patch.endpoint).toBe(`/trainers/me/forms/${local.id}`);
    expect(JSON.parse(patch.payload).expectedRevision).toBe(0);

    await drain();
    const sent = server.calls.find((c) => c.method === "PATCH");
    expect(sent?.url).toBe(`${BASE}/trainers/me/forms/f-1`);
    expect(sent?.body.expectedRevision).toBe(1);
    expect(server.forms[0]).toMatchObject({ title: "B", revision: 2 });
    expect(queued()).toHaveLength(0);
    expect(storage.getCachedCoachForms(USER)!.forms[0]).toMatchObject({
      id: "f-1",
      revision: 2,
    });
  });
});

describe("form edit (PATCH with expectedRevision)", () => {
  it("sends the cached revision, folds repeat edits, and takes the server's new revision", async () => {
    seedForm("f-1", 3);
    saveFormCommand(deps(), {
      id: "f-1",
      title: "One",
      description: null,
      questions: [Q("q1")],
    });
    saveFormCommand(deps(), {
      id: "f-1",
      title: "Two",
      description: null,
      questions: [Q("q1")],
    });
    expect(queued()).toHaveLength(1);
    expect(JSON.parse(queued()[0]!.payload)).toMatchObject({
      title: "Two",
      expectedRevision: 3,
    });
    expect(storage.getCachedCoachForms(USER)!.forms[0]!.title).toBe("Two");
    await drain();
    expect(server.forms[0]).toMatchObject({ title: "Two", revision: 4 });
    expect(storage.getCachedCoachForms(USER)!.forms[0]!.revision).toBe(4);
  });

  it("a second edit made while the first is in flight is rebased, not a conflict", async () => {
    seedForm("f-1", 3);
    saveFormCommand(deps(), {
      id: "f-1",
      title: "One",
      description: null,
      questions: [Q("q1")],
    });
    storage.markMutationDispatched(queued()[0]!.id);
    saveFormCommand(deps(), {
      id: "f-1",
      title: "Two",
      description: null,
      questions: [Q("q1")],
    });
    expect(queued()).toHaveLength(2);
    await drain();
    expect(server.forms[0]).toMatchObject({ title: "Two", revision: 5 });
    expect(storage.getCoachFormConflicts(USER)).toEqual([]);
    expect(storage.getCachedCoachForms(USER)!.forms[0]).toMatchObject({
      title: "Two",
      revision: 5,
    });
  });

  it("keeps the phone's newer content when a later edit is still queued", () => {
    seedForm("f-1", 3);
    saveFormCommand(deps(), {
      id: "f-1",
      title: "Mine",
      description: null,
      questions: [Q("q1")],
    });
    const first = queued()[0]!;
    storage.markMutationDispatched(first.id);
    saveFormCommand(deps(), {
      id: "f-1",
      title: "Newer",
      description: null,
      questions: [Q("q9")],
    });
    applyCoachFormsSyncSuccess(
      storage,
      first,
      serverForm("f-1", "Mine", [Q("q1")], 4),
    );
    const cached = storage.getCachedCoachForms(USER)!.forms[0]!;
    expect(cached).toMatchObject({ title: "Newer", revision: 4 });
    expect(cached.version?.questions[0]?.id).toBe("q9");
    expect(JSON.parse(queued()[1]!.payload).expectedRevision).toBe(4);
  });
});

describe("409 revision_conflict", () => {
  it("takes the server copy, drops the queued edits and says Edited on another device", async () => {
    seedForm("f-1", 3);
    // Someone edits it on the web.
    server.forms[0]!.revision = 4;
    server.forms[0]!.title = "Edited on the web";
    server.offline = true;
    saveFormCommand(deps(), {
      id: "f-1",
      title: "Mine",
      description: null,
      questions: [Q("q1")],
    });
    storage.markMutationDispatched(queued()[0]!.id);
    saveFormCommand(deps(), {
      id: "f-1",
      title: "Mine again",
      description: null,
      questions: [Q("q1")],
    });
    expect(queued()).toHaveLength(2);

    server.offline = false;
    const result = await drain();
    expect(result.failed).toBe(1);
    expect(queued()).toHaveLength(0);
    const cached = storage.getCachedCoachForms(USER)!.forms[0]!;
    expect(cached).toMatchObject({ title: "Edited on the web", revision: 4 });
    expect(storage.getCoachFormConflicts(USER).map((c) => c.key)).toEqual([
      "form:f-1",
    ]);

    // Not retried: a second drain sends nothing.
    const before = server.calls.length;
    await drain();
    expect(server.calls.length).toBe(before);
  });

  it("works for send rules too", async () => {
    seedForm("f-1", 1);
    const s: FormSchedule = {
      id: "s-1",
      formId: "f-1",
      trigger: "weekly",
      audience: "all_clients",
      weekday: 7,
      timeLocal: "09:00",
      dueAfterHours: 27,
      reminders: [],
      status: "active",
      revision: 2,
      clients: [],
      createdAt: "x",
      updatedAt: "x",
    };
    server.schedules.push({ ...s, revision: 3, timeLocal: "07:00" });
    storage.cacheCoachFormSchedules(USER, [s]);
    saveScheduleCommand(deps(), {
      scheduleId: "s-1",
      formId: "f-1",
      trigger: "weekly",
      audience: "all_clients",
      clientIds: [],
      weekday: 7,
      timeLocal: "10:00",
      dueAfterHours: 27,
      reminders: [],
    });
    expect(JSON.parse(queued()[0]!.payload).expectedRevision).toBe(2);
    await drain();
    expect(queued()).toHaveLength(0);
    expect(storage.getCachedCoachFormSchedules(USER)![0]).toMatchObject({
      revision: 3,
      timeLocal: "07:00",
    });
    expect(storage.getCoachFormConflicts(USER).map((c) => c.key)).toEqual([
      "schedule:s-1",
    ]);
  });

  it("a 409 that isn't a revision conflict takes the ordinary failure path", () => {
    const entry = {
      id: 1,
      entityType: COACH_FORM_ENTITY,
      entityId: `${USER}:f-1`,
      method: "PATCH",
      payload: "{}",
    } as never;
    expect(applyCoachFormsConflict(storage, entry, '{"code":"other"}')).toBe(
      false,
    );
    expect(applyCoachFormsConflict(storage, entry, "not json")).toBe(false);
    expect(
      applyCoachFormsConflict(
        storage,
        { ...(entry as object), method: "POST" } as never,
        "{}",
      ),
    ).toBe(false);
    expect(
      applyCoachFormsConflict(
        storage,
        { ...(entry as object), entityType: "coach_form_review" } as never,
        '{"code":"revision_conflict","current":{"id":"x"}}',
      ),
    ).toBe(false);
  });

  it("adds a server copy the cache didn't know", () => {
    storage.cacheCoachForms(USER, { forms: [], templates: [], asOf: "a" });
    storage.cacheCoachFormSchedules(USER, []);
    const entry = {
      id: 1,
      entityType: COACH_FORM_ENTITY,
      entityId: `${USER}:f-9`,
      method: "PATCH",
      payload: "{}",
    } as never;
    const body = JSON.stringify({
      code: "revision_conflict",
      current: serverForm("f-9", "Theirs", [], 2),
    });
    expect(applyCoachFormsConflict(storage, entry, body)).toBe(true);
    expect(storage.getCachedCoachForms(USER)!.forms[0]!.id).toBe("f-9");
    const sEntry = {
      ...(entry as object),
      entityType: COACH_FORM_SCHEDULE_ENTITY,
    } as never;
    expect(
      applyCoachFormsConflict(
        storage,
        sEntry,
        JSON.stringify({
          code: "revision_conflict",
          current: { id: "s-9", formId: "f-9" },
        }),
      ),
    ).toBe(true);
    expect(storage.getCachedCoachFormSchedules(USER)![0]!.id).toBe("s-9");
  });
});

describe("send rules (schedule create and edit)", () => {
  it("a rule for a form made offline waits for the form and sends its real id", async () => {
    server.offline = true;
    const local = saveFormCommand(deps(), {
      title: "A",
      description: null,
      questions: [Q("q1")],
    });
    storage.cacheCoachClientForms(USER, "c1", []);
    const rule = saveScheduleCommand(deps(), {
      formId: local.id,
      trigger: "weekly",
      audience: "selected",
      clientIds: ["c1"],
      weekday: 7,
      timeLocal: "09:00",
      dueAfterHours: 27,
      reminders: [{ afterHours: 24 }, { afterHours: 9 }],
    });
    expect(rule.id).toMatch(/^local-/);
    // Optimistically in the client's "Sent to".
    expect(storage.getCachedCoachClientForms(USER, "c1")![0]!.form.title).toBe(
      "A",
    );
    server.offline = false;
    await drain();
    const post = server.calls.find((c) => c.url.endsWith("/form-schedules"));
    expect(post?.body).toMatchObject({
      formId: "f-1",
      trigger: "weekly",
      audience: "selected",
      clientIds: ["c1"],
      reminders: [{ afterHours: 9 }, { afterHours: 24 }],
    });
    expect(post?.key).toBeTruthy();
    expect(
      storage.getCachedCoachFormSchedules(USER)!.map((s) => [s.id, s.formId]),
    ).toEqual([[server.schedules[0]!.id, "f-1"]]);
    expect(resolveCoachFormsId(rule.id)).toBe(server.schedules[0]!.id);
    expect(queued()).toHaveLength(0);
  });

  it("all-clients rules send no clientIds and keep weekday/time only where they belong", () => {
    seedForm("f-1");
    saveScheduleCommand(deps(), {
      formId: "f-1",
      trigger: "on_join",
      audience: "all_clients",
      clientIds: ["ignored"],
      weekday: 7,
      timeLocal: "09:00",
      dueAfterHours: 48,
      reminders: [],
    });
    expect(JSON.parse(queued()[0]!.payload)).toEqual({
      formId: "f-1",
      trigger: "on_join",
      audience: "all_clients",
      weekday: null,
      timeLocal: null,
      dueAfterHours: 48,
      reminders: [],
    });
  });

  it("changing an existing rule's cadence stops it and sends a new one", async () => {
    seedForm("f-1");
    const s: FormSchedule = {
      id: "s-1",
      formId: "f-1",
      trigger: "weekly",
      audience: "all_clients",
      weekday: 7,
      timeLocal: "09:00",
      dueAfterHours: 27,
      reminders: [],
      status: "active",
      revision: 1,
      clients: [],
      createdAt: "x",
      updatedAt: "x",
    };
    server.schedules.push({ ...s });
    storage.cacheCoachFormSchedules(USER, [s]);
    saveScheduleCommand(deps(), {
      scheduleId: "s-1",
      formId: "f-1",
      trigger: "daily",
      audience: "all_clients",
      clientIds: [],
      weekday: null,
      timeLocal: "08:00",
      dueAfterHours: 4,
      reminders: [],
    });
    expect(queued().map((e) => e.method)).toEqual(["PATCH", "POST"]);
    expect(JSON.parse(queued()[0]!.payload)).toEqual({
      status: "stopped",
      expectedRevision: 1,
    });
    await drain();
    expect(server.schedules.map((x) => [x.trigger, x.status])).toEqual([
      ["weekly", "stopped"],
      ["daily", "active"],
    ]);
  });

  it("changing the cadence of a rule nothing has sent just replaces it", () => {
    seedForm("f-1");
    const draft = {
      formId: "f-1",
      trigger: "weekly" as const,
      audience: "selected" as const,
      clientIds: ["c1"],
      weekday: 7,
      timeLocal: "09:00",
      dueAfterHours: 27,
      reminders: [],
    };
    const first = saveScheduleCommand(deps(), draft);
    saveScheduleCommand(deps(), {
      ...draft,
      scheduleId: first.id,
      trigger: "once",
      weekday: null,
      timeLocal: null,
    });
    expect(queued()).toHaveLength(1);
    expect(JSON.parse(queued()[0]!.payload).trigger).toBe("once");
    expect(
      storage.getCachedCoachFormSchedules(USER)!.map((s) => s.trigger),
    ).toEqual(["once"]);
  });

  it("editing a rule keeps its clients and folds repeat edits into one PATCH", () => {
    seedForm("f-1");
    const s: FormSchedule = {
      id: "s-1",
      formId: "f-1",
      trigger: "weekly",
      audience: "selected",
      weekday: 7,
      timeLocal: "09:00",
      dueAfterHours: 27,
      reminders: [],
      status: "active",
      revision: 5,
      clients: [
        {
          clientId: "c1",
          relationshipId: "r1",
          status: "paused",
          override: null,
        },
      ],
      createdAt: "x",
      updatedAt: "x",
    };
    storage.cacheCoachFormSchedules(USER, [s]);
    const base = {
      scheduleId: "s-1",
      formId: "f-1",
      trigger: "weekly" as const,
      audience: "selected" as const,
      clientIds: ["c1", "c2"],
      weekday: 1,
      timeLocal: "09:00",
      dueAfterHours: 27,
      reminders: [],
    };
    const next = saveScheduleCommand(deps(), base);
    expect(next.clients.map((c) => [c.clientId, c.status])).toEqual([
      ["c1", "paused"],
      ["c2", "active"],
    ]);
    saveScheduleCommand(deps(), { ...base, timeLocal: "10:00" });
    expect(queued()).toHaveLength(1);
    expect(JSON.parse(queued()[0]!.payload)).toMatchObject({
      timeLocal: "10:00",
      weekday: 1,
      expectedRevision: 5,
      clientIds: ["c1", "c2"],
    });
    saveScheduleCommand(deps(), { ...base, audience: "all_clients" });
    expect(storage.getCachedCoachFormSchedules(USER)![0]!.clients).toHaveLength(
      2,
    );
  });
});

describe("per-client setup (C10j) and review", () => {
  const clientForm = (state: ClientForm["state"]): ClientForm => ({
    form: { id: "f-1", title: "Weekly check-in", archivedAt: null },
    rule: {
      scheduleId: "s-1",
      trigger: "weekly",
      audience: "all_clients",
      status: "active",
      clientStatus: null,
      weekday: 7,
      timeLocal: "09:00",
      dueAfterHours: 27,
      reminders: [],
      override: null,
    },
    rules: [
      {
        scheduleId: "s-1",
        trigger: "weekly",
        audience: "all_clients",
        status: "active",
        clientStatus: null,
        weekday: 7,
        timeLocal: "09:00",
        dueAfterHours: 27,
        reminders: [],
        override: null,
      },
    ],
    lastDoneAt: "2026-11-23T10:00:00Z",
    lastSentAt: null,
    pendingRequestId: null,
    state,
  });

  it("pause, then save an override: optimistic, one PUT (last write wins), server copy adopted", async () => {
    storage.cacheCoachClientForms(USER, "c1", [clientForm("done")]);
    server.offline = true;
    setClientFormSetupCommand(deps(), "c1", "f-1", { status: "paused" });
    expect(storage.getCachedCoachClientForms(USER, "c1")![0]!.state).toBe(
      "paused",
    );
    setClientFormSetupCommand(deps(), "c1", "f-1", {
      status: "active",
      override: { trigger: "daily", timeLocal: "07:00", weekday: null },
      scheduleId: "s-1",
    });
    expect(queued()).toHaveLength(1);
    const cached = storage.getCachedCoachClientForms(USER, "c1")![0]!;
    expect(cached.state).toBe("done");
    expect(cached.rules[0]!.override).toMatchObject({
      trigger: "daily",
      timeLocal: "07:00",
    });
    server.offline = false;
    await drain();
    expect(server.setups).toEqual([
      {
        clientId: "c1",
        formId: "f-1",
        body: {
          status: "active",
          override: { trigger: "daily", timeLocal: "07:00", weekday: null },
          scheduleId: "s-1",
        },
      },
    ]);
    expect(storage.getCachedCoachClientForms(USER, "c1")![0]!.form.title).toBe(
      "Server title",
    );
  });

  it("stop removes the form for this client; an override of null clears it", async () => {
    storage.cacheCoachClientForms(USER, "c1", [clientForm("notDoneYet")]);
    setClientFormSetupCommand(deps(), "c1", "f-1", { status: "excluded" });
    expect(storage.getCachedCoachClientForms(USER, "c1")).toEqual([]);
    await drain();
    expect(storage.getCachedCoachClientForms(USER, "c1")).toEqual([]);

    storage.cacheCoachClientForms(USER, "c2", [
      { ...clientForm("notDoneYet"), lastDoneAt: null },
    ]);
    setClientFormSetupCommand(deps(), "c2", "f-1", {
      status: "active",
      override: null,
      scheduleId: "other",
    });
    expect(
      storage.getCachedCoachClientForms(USER, "c2")![0]!.rules[0]!.override,
    ).toBeNull();
  });

  it("works with nothing cached and adds the server's row", async () => {
    setClientFormSetupCommand(deps(), "c3", "f-1", { status: "active" });
    await drain();
    expect(storage.getCachedCoachClientForms(USER, "c3")).toBeNull();
    storage.cacheCoachClientForms(USER, "c3", []);
    setClientFormSetupCommand(deps(), "c3", "f-1", { status: "active" });
    await drain();
    expect(storage.getCachedCoachClientForms(USER, "c3")![0]!.form.id).toBe(
      "f-1",
    );
  });

  it("review and reply queue offline, fold, and replay idempotently", async () => {
    storage.cacheCoachFormResponses(USER, "c1", [
      response("r1"),
      response("r2"),
    ]);
    server.offline = true;
    reviewResponseCommand(deps(), "c1", "r1");
    reviewResponseCommand(deps(), "c1", "r1", "  Great week ");
    const cached = storage.getCachedCoachFormResponses(USER, "c1")!;
    expect(cached[0]!.reviewedAt).not.toBeNull();
    expect(cached[0]!.replyText).toBe("Great week");
    expect(cached[1]!.reviewedAt).toBeNull();
    expect(queued()).toHaveLength(1);
    expect(JSON.parse(queued()[0]!.payload)).toEqual({
      replyText: "Great week",
    });
    server.offline = false;
    await drain();
    expect(storage.getCachedCoachFormResponses(USER, "c1")![0]).toMatchObject({
      reviewedAt: "2026-11-24T10:00:00Z",
      replyText: "Great week",
    });
    // Mark reviewed again: same first review time, reply kept.
    reviewResponseCommand(deps(), "c1", "r1");
    await drain();
    expect(server.reviews.get("r1")).toEqual({
      reviewedAt: "2026-11-24T10:00:00Z",
      replyText: "Great week",
    });
    // Nothing cached for another client: still queues.
    reviewResponseCommand(deps(), "c9", "r9");
    expect(queued()).toHaveLength(1);
  });
});

describe("reads keep queued intent (reconcile)", () => {
  it("forms: a live edit or offline create beats the server's older copy", () => {
    seedForm("f-1", 3);
    expect(
      reconcileCoachForms(storage, USER, {
        forms: [],
        templates: [],
        asOf: "x",
      }).forms,
    ).toEqual([]);
    saveFormCommand(deps(), {
      id: "f-1",
      title: "Mine",
      description: null,
      questions: [Q("q1")],
    });
    const local = saveFormCommand(deps(), {
      title: "New",
      description: null,
      questions: [Q("q1")],
    });
    const out = reconcileCoachForms(storage, USER, {
      forms: [
        serverForm("f-1", "Old", [], 3),
        serverForm("f-2", "Other", [], 1),
      ],
      templates: [],
      asOf: "x",
    });
    expect(out.forms.map((f) => [f.id, f.title])).toEqual([
      [local.id, "New"],
      ["f-1", "Mine"],
      ["f-2", "Other"],
    ]);
    const empty = new InMemoryStorageAdapter();
    expect(
      reconcileCoachForms(empty, USER, { forms: [], templates: [], asOf: "x" })
        .forms,
    ).toEqual([]);
  });

  it("send rules, client forms and responses likewise", () => {
    expect(reconcileCoachFormSchedules(storage, USER, [])).toEqual([]);
    seedForm("f-1");
    storage.cacheCoachFormSchedules(USER, []);
    expect(reconcileCoachFormSchedules(storage, USER, [])).toEqual([]);
    const rule = saveScheduleCommand(deps(), {
      formId: "f-1",
      trigger: "once",
      audience: "all_clients",
      clientIds: [],
      weekday: null,
      timeLocal: null,
      dueAfterHours: null,
      reminders: [],
    });
    const other = { ...rule, id: "s-2" };
    expect(
      reconcileCoachFormSchedules(storage, USER, [other]).map((s) => s.id),
    ).toEqual(["s-2", rule.id]);

    const cf = (id: string, title: string): ClientForm => ({
      form: { id, title, archivedAt: null },
      rule: null,
      rules: [],
      lastDoneAt: null,
      lastSentAt: null,
      pendingRequestId: null,
      state: "notDoneYet",
    });
    expect(
      reconcileClientForms(storage, USER, "c1", [cf("f-1", "S")]),
    ).toHaveLength(1);
    storage.cacheCoachClientForms(USER, "c1", [
      cf("f-1", "Local"),
      cf("f-2", "Local 2"),
    ]);
    setClientFormSetupCommand(deps(), "c1", "f-1", { status: "paused" });
    setClientFormSetupCommand(deps(), "c1", "f-2", { status: "excluded" });
    expect(
      reconcileClientForms(storage, USER, "c1", [
        cf("f-1", "Server"),
        cf("f-2", "Server 2"),
        cf("f-3", "Server 3"),
      ]).map((f) => [f.form.id, f.state]),
    ).toEqual([
      ["f-1", "paused"],
      ["f-3", "notDoneYet"],
    ]);

    expect(
      reconcileResponses(storage, USER, "c1", [response("r1")])[0]!.reviewedAt,
    ).toBeNull();
    storage.cacheCoachFormResponses(USER, "c1", [response("r1")]);
    reviewResponseCommand(deps(), "c1", "r1");
    const out = reconcileResponses(storage, USER, "c1", [
      response("r1"),
      response("r2"),
    ]);
    expect(out[0]!.reviewedAt).not.toBeNull();
    expect(out[1]!.reviewedAt).toBeNull();
  });
});

describe("success replies the cache can't use", () => {
  it("are ignored without throwing", () => {
    const e = (entityType: string, entityId: string | null, method = "POST") =>
      ({ id: 99, entityType, entityId, method, payload: "{}" }) as never;
    expect(() => {
      applyCoachFormsSyncSuccess(storage, e(COACH_FORM_ENTITY, null), {});
      applyCoachFormsSyncSuccess(
        storage,
        e(COACH_FORM_ENTITY, `${USER}:x`),
        null,
      );
      applyCoachFormsSyncSuccess(
        storage,
        e(COACH_FORM_SCHEDULE_ENTITY, `${USER}:x`),
        {},
      );
      applyCoachFormsSyncSuccess(
        storage,
        e("coach_client_form_setup", `${USER}`),
        {},
      );
      applyCoachFormsSyncSuccess(
        storage,
        e("coach_form_review", `${USER}`),
        {},
      );
      applyCoachFormsSyncSuccess(
        storage,
        e("coach_form_review", `${USER}:c1:r1`),
        { id: "r1" },
      );
      applyCoachFormsSyncSuccess(storage, e("other", `${USER}:x`), { id: "x" });
    }).not.toThrow();
    // A form reply with no cached library leaves the cache empty.
    applyCoachFormsSyncSuccess(
      storage,
      e(COACH_FORM_ENTITY, `${USER}:f-1`, "PATCH"),
      serverForm("f-1", "X", [], 2),
    );
    expect(storage.getCachedCoachForms(USER)).toBeNull();
  });
});
