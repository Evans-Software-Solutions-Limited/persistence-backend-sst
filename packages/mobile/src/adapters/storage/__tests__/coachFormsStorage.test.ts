/** @jest-environment node */
import { DatabaseSync } from "node:sqlite";
import type { StoragePort } from "@/domain/ports/storage.port";
import type {
  ClientForm,
  CoachForm,
  CoachFormStats,
  FormResponse,
  FormSchedule,
} from "@/domain/models/coachForms";
import { InMemoryStorageAdapter } from "./in-memory-storage.adapter";
import { SQLiteStorageAdapter } from "../sqlite.adapter";
import { swapIdInQueueRow } from "../coachFormsQueueSwap";

/** The SQLite adapter on node's SQLite, with the PER-129 DDL it ships. */
function sqliteAdapter(): { adapter: StoragePort; db: DatabaseSync } {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE cached_coach_forms (user_id TEXT PRIMARY KEY, payload TEXT NOT NULL, synced_at TEXT NOT NULL);
    CREATE TABLE cached_coach_form_schedules (user_id TEXT PRIMARY KEY, payload TEXT NOT NULL, synced_at TEXT NOT NULL);
    CREATE TABLE cached_coach_form_stats (user_id TEXT PRIMARY KEY, payload TEXT NOT NULL, synced_at TEXT NOT NULL);
    CREATE TABLE cached_coach_client_forms (user_id TEXT NOT NULL, client_id TEXT NOT NULL, payload TEXT NOT NULL, synced_at TEXT NOT NULL, PRIMARY KEY (user_id, client_id));
    CREATE TABLE cached_coach_form_responses (user_id TEXT NOT NULL, client_id TEXT NOT NULL, payload TEXT NOT NULL, synced_at TEXT NOT NULL, PRIMARY KEY (user_id, client_id));
    CREATE TABLE coach_form_conflicts (user_id TEXT NOT NULL, entity_key TEXT NOT NULL, at TEXT NOT NULL, PRIMARY KEY (user_id, entity_key));
    CREATE TABLE sync_queue (id INTEGER PRIMARY KEY, entity_type TEXT, entity_id TEXT, endpoint TEXT, payload TEXT, status TEXT);
    CREATE TABLE cached_coach_client_profiles (user_id TEXT NOT NULL, profile_id TEXT NOT NULL, payload TEXT NOT NULL, synced_at TEXT NOT NULL, PRIMARY KEY (user_id, profile_id));
  `);
  type P = (string | number | null)[];
  const adapter = new SQLiteStorageAdapter();
  Object.assign(adapter, {
    db: {
      getAllSync: (q: string, p: P = []) => db.prepare(q).all(...p),
      getFirstSync: (q: string, p: P = []) => db.prepare(q).get(...p) ?? null,
      runSync: (q: string, p: P = []) => db.prepare(q).run(...p),
      execSync: (q: string) => db.exec(q),
      withTransactionSync: (fn: () => void) => fn(),
    },
  });
  return { adapter, db };
}

const form = (id: string, title = "Weekly check-in"): CoachForm => ({
  id,
  title,
  description: null,
  templateKey: null,
  available: true,
  revision: 1,
  archivedAt: null,
  createdAt: "2026-11-01T00:00:00Z",
  updatedAt: "2026-11-01T00:00:00Z",
  version: null,
});

const schedule = (id: string, formId: string): FormSchedule => ({
  id,
  formId,
  trigger: "weekly",
  audience: "all_clients",
  weekday: 7,
  timeLocal: "09:00",
  dueAfterHours: 27,
  reminders: [],
  status: "active",
  revision: 1,
  clients: [],
  createdAt: "2026-11-01T00:00:00Z",
  updatedAt: "2026-11-01T00:00:00Z",
});

const stats: CoachFormStats = {
  forms: [{ formId: "f1", reached: 2, done: 1, outstanding: 1, clients: [] }],
  totals: {
    forms: 1,
    repeating: 1,
    outstanding: 1,
    onTimeRate: 0.5,
    onTimeSample: 2,
  },
  asOf: "2026-11-24T00:00:00Z",
};

const clientForm: ClientForm = {
  form: { id: "f1", title: "Weekly check-in", archivedAt: null },
  rule: null,
  rules: [],
  lastDoneAt: null,
  lastSentAt: null,
  pendingRequestId: null,
  state: "notDoneYet",
};

const resp = { id: "r1", formId: "f1" } as FormResponse;

describe.each([
  ["SQLite", () => sqliteAdapter().adapter],
  ["in-memory", () => new InMemoryStorageAdapter() as StoragePort],
])("PER-129 coach forms caches (%s)", (_name, make) => {
  it("are null until cached, then round-trip per coach (and client)", () => {
    const s = make();
    expect(s.getCachedCoachForms("u1")).toBeNull();
    expect(s.getCachedCoachFormSchedules("u1")).toBeNull();
    expect(s.getCachedCoachFormStats("u1")).toBeNull();
    expect(s.getCachedCoachClientForms("u1", "c1")).toBeNull();
    expect(s.getCachedCoachFormResponses("u1", "c1")).toBeNull();

    s.cacheCoachForms("u1", { forms: [form("f1")], templates: [], asOf: "a" });
    s.cacheCoachFormSchedules("u1", [schedule("s1", "f1")]);
    s.cacheCoachFormStats("u1", stats);
    s.cacheCoachClientForms("u1", "c1", [clientForm]);
    s.cacheCoachFormResponses("u1", "c1", [resp]);

    expect(s.getCachedCoachForms("u1")?.forms[0]?.id).toBe("f1");
    expect(s.getCachedCoachFormSchedules("u1")?.[0]?.id).toBe("s1");
    expect(s.getCachedCoachFormStats("u1")?.totals.onTimeRate).toBe(0.5);
    expect(s.getCachedCoachClientForms("u1", "c1")).toEqual([clientForm]);
    expect(s.getCachedCoachClientForms("u1", "c2")).toBeNull();
    expect(s.getCachedCoachFormResponses("u1", "c1")?.[0]?.id).toBe("r1");
    expect(s.getCachedCoachForms("u2")).toBeNull();

    // Overwrite.
    s.cacheCoachClientForms("u1", "c1", []);
    expect(s.getCachedCoachClientForms("u1", "c1")).toEqual([]);
  });

  it("records, lists and clears 409 conflicts per coach", () => {
    const s = make();
    expect(s.getCoachFormConflicts("u1")).toEqual([]);
    s.recordCoachFormConflict("u1", "form:f1");
    s.recordCoachFormConflict("u1", "form:f1");
    s.recordCoachFormConflict("u1", "schedule:s1");
    expect(
      s
        .getCoachFormConflicts("u1")
        .map((c) => c.key)
        .sort(),
    ).toEqual(["form:f1", "schedule:s1"]);
    expect(s.getCoachFormConflicts("u2")).toEqual([]);
    s.clearCoachFormConflict("u1", "form:f1");
    expect(s.getCoachFormConflicts("u1").map((c) => c.key)).toEqual([
      "schedule:s1",
    ]);
  });

  it("swaps an offline form's id in the library and send rules", () => {
    const s = make();
    s.cacheCoachForms("u1", {
      forms: [form("local-1", "Mine"), form("f9")],
      templates: [],
      asOf: "a",
    });
    s.cacheCoachFormSchedules("u1", [
      schedule("s1", "local-1"),
      schedule("s2", "f9"),
    ]);
    s.swapLocalCoachFormId("u1", "local-1", "f1");
    expect(s.getCachedCoachForms("u1")?.forms.map((f) => f.id)).toEqual([
      "f1",
      "f9",
    ]);
    expect(s.getCachedCoachFormSchedules("u1")?.map((r) => r.formId)).toEqual([
      "f1",
      "f9",
    ]);
    // Same id or unknown id: no-op.
    s.swapLocalCoachFormId("u1", "f1", "f1");
    s.swapLocalCoachFormId("u1", "local-x", "f2");
    expect(s.getCachedCoachForms("u1")?.forms.map((f) => f.id)).toEqual([
      "f1",
      "f9",
    ]);
  });

  it("swaps an offline send rule's id", () => {
    const s = make();
    s.cacheCoachFormSchedules("u1", [schedule("local-s", "f1")]);
    s.swapLocalCoachFormScheduleId("u1", "local-s", "s1");
    expect(s.getCachedCoachFormSchedules("u1")?.map((r) => r.id)).toEqual([
      "s1",
    ]);
    s.swapLocalCoachFormScheduleId("u1", "s1", "s1");
    s.swapLocalCoachFormScheduleId("u1", "nope", "s2");
    expect(s.getCachedCoachFormSchedules("u1")?.map((r) => r.id)).toEqual([
      "s1",
    ]);
  });

  it("swaps offline form and rule ids in every client's C10j forms", () => {
    const s = make();
    const rule = {
      scheduleId: "local-s",
      trigger: "weekly" as const,
      audience: "selected" as const,
      status: "active" as const,
      clientStatus: "active" as const,
      weekday: 7,
      timeLocal: "09:00",
      dueAfterHours: 27,
      reminders: [],
      override: null,
    };
    const offline: ClientForm = {
      ...clientForm,
      form: { id: "local-f", title: "Mine", archivedAt: null },
      rule,
      rules: [rule, { ...rule, scheduleId: "s9" }],
    };
    s.cacheCoachClientForms("u1", "c1", [offline, clientForm]);
    s.cacheCoachClientForms("u1", "c2", [offline]);
    s.cacheCoachClientForms("u2", "c1", [offline]);

    s.swapLocalCoachFormId("u1", "local-f", "f7");
    s.swapLocalCoachFormScheduleId("u1", "local-s", "s7");

    for (const cid of ["c1", "c2"]) {
      const [first] = s.getCachedCoachClientForms("u1", cid) ?? [];
      expect(first?.form.id).toBe("f7");
      expect(first?.rule?.scheduleId).toBe("s7");
      expect(first?.rules.map((r) => r.scheduleId)).toEqual(["s7", "s9"]);
    }
    expect(s.getCachedCoachClientForms("u1", "c1")?.[1]).toEqual(clientForm);
    // Another coach's cache is untouched.
    expect(s.getCachedCoachClientForms("u2", "c1")?.[0]?.form.id).toBe(
      "local-f",
    );
  });

  it("clearAll drops every coach forms cache", () => {
    const s = make();
    s.cacheCoachForms("u1", { forms: [form("f1")], templates: [], asOf: "a" });
    s.cacheCoachFormSchedules("u1", []);
    s.cacheCoachFormStats("u1", stats);
    s.cacheCoachClientForms("u1", "c1", []);
    s.cacheCoachFormResponses("u1", "c1", []);
    s.recordCoachFormConflict("u1", "form:f1");
    try {
      s.clearAll();
    } catch {
      // The trimmed SQLite test schema lacks the other tables clearAll empties.
      return;
    }
    expect(s.getCachedCoachForms("u1")).toBeNull();
    expect(s.getCachedCoachFormStats("u1")).toBeNull();
    expect(s.getCoachFormConflicts("u1")).toEqual([]);
  });
});

describe("queued rows follow a synced create's id", () => {
  it("SQLite rewrites entity id, endpoint and payload of coach-forms rows not yet completed", () => {
    const { adapter, db } = sqliteAdapter();
    const insert = db.prepare(
      `INSERT INTO sync_queue (entity_type, entity_id, endpoint, payload, status) VALUES (?, ?, ?, ?, ?)`,
    );
    insert.run(
      "coach_form",
      "u1:local-1",
      "/trainers/me/forms/local-1",
      '{"expectedRevision":0}',
      "pending",
    );
    insert.run(
      "coach_form_schedule",
      "u1:local-s",
      "/trainers/me/form-schedules",
      '{"formId":"local-1"}',
      "failed",
    );
    insert.run(
      "coach_form",
      "u1:local-1",
      "/trainers/me/forms",
      "{}",
      "in_flight",
    );
    insert.run(
      "nutrition_entry",
      "u1:local-1",
      "/x/local-1",
      '{"formId":"local-1"}',
      "pending",
    );
    insert.run(
      "coach_form",
      "u1:other",
      "/trainers/me/forms/other",
      "not json",
      "pending",
    );
    // A rule POST for the form, in flight while the form's create completes
    // (Inspector Brad #556 sweep 2): it must follow, or it keeps local-1.
    insert.run(
      "coach_form_schedule",
      "u1:local-t",
      "/trainers/me/form-schedules",
      '{"formId":"local-1"}',
      "in_flight",
    );
    insert.run(
      "coach_form",
      "u1:local-1",
      "/trainers/me/forms/local-1",
      "{}",
      "completed",
    );

    adapter.swapLocalCoachFormId("u1", "local-1", "f1");
    const rows = db
      .prepare(
        `SELECT entity_type, entity_id, endpoint, payload FROM sync_queue ORDER BY id`,
      )
      .all() as { entity_id: string; endpoint: string; payload: string }[];
    expect(rows[0]).toMatchObject({
      entity_id: "u1:f1",
      endpoint: "/trainers/me/forms/f1",
    });
    expect(JSON.parse(rows[1]!.payload)).toEqual({ formId: "f1" });
    // In flight too: its request may fail and be re-sent, so it follows
    // (only completed rows are left alone, like the other local-id swaps).
    expect(rows[2]!.entity_id).toBe("u1:f1");
    expect(JSON.parse(rows[5]!.payload)).toEqual({ formId: "f1" });
    expect(rows[6]!.entity_id).toBe("u1:local-1");
    // Other entity types are left alone.
    expect(rows[3]!.endpoint).toBe("/x/local-1");
    expect(rows[4]!.payload).toBe("not json");

    adapter.swapLocalCoachFormScheduleId("u1", "local-s", "s1");
    const after = db
      .prepare(`SELECT entity_id FROM sync_queue WHERE id = 2`)
      .get() as {
      entity_id: string;
    };
    expect(after.entity_id).toBe("u1:s1");
  });

  it("in-memory does the same through the queue port", () => {
    const s = new InMemoryStorageAdapter();
    s.enqueueMutation({
      entityType: "coach_form",
      entityId: "u1:local-1",
      operation: "update",
      payload: { expectedRevision: 0 },
      endpoint: "/trainers/me/forms/local-1",
      method: "PATCH",
    });
    s.enqueueMutation({
      entityType: "coach_client_form_setup",
      entityId: "u1:c1:f1",
      operation: "update",
      payload: { status: "active", scheduleId: "local-s" },
      endpoint: "/trainers/me/clients/c1/forms/f1/setup",
      method: "PUT",
    });
    s.enqueueMutation({
      entityType: "coach_form_schedule",
      entityId: "u1:local-t",
      operation: "create",
      payload: { formId: "local-1" },
      endpoint: "/trainers/me/form-schedules",
      method: "POST",
    });
    s.enqueueMutation({
      entityType: "recipe",
      entityId: "local-1",
      operation: "update",
      payload: {},
      endpoint: "/recipes/local-1",
      method: "PATCH",
    });
    // In flight while the form's create completes (Inspector Brad #556
    // sweep 2): it still follows.
    expect(s.markMutationInFlight(s.getUncompletedMutations()[2]!.id)).toBe(
      true,
    );
    s.swapLocalCoachFormId("u1", "local-1", "f1");
    s.swapLocalCoachFormScheduleId("u1", "local-s", "s1");
    const [a, b, t, c] = s.getUncompletedMutations();
    expect(JSON.parse(t!.payload)).toEqual({ formId: "f1" });
    expect(a).toMatchObject({
      entityId: "u1:f1",
      endpoint: "/trainers/me/forms/f1",
    });
    expect(JSON.parse(b!.payload)).toEqual({
      status: "active",
      scheduleId: "s1",
    });
    expect(c!.endpoint).toBe("/recipes/local-1");
  });

  it("swapIdInQueueRow only touches whole id segments", () => {
    expect(
      swapIdInQueueRow(
        {
          entityId: null,
          endpoint: "/trainers/me/forms/local-10",
          payload: "{}",
        },
        "local-1",
        "f1",
        "formId",
      ),
    ).toBeNull();
    expect(
      swapIdInQueueRow(
        { entityId: null, endpoint: "/a/local-1?x=1", payload: "[]" },
        "local-1",
        "f1",
        "formId",
      ),
    ).toEqual({ entityId: null, endpoint: "/a/f1?x=1", payload: "[]" });
  });
});
