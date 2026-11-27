/**
 * PER-125 — invited clients, set-up and C3.9 settings written offline and
 * replayed through the queue. The fake server behaves like BE-A1: create is
 * idempotent on `Idempotency-Key`; PATCH / PUT check `expectedRevision` and
 * answer 409 `revision_conflict` with `current`; every profile or set-up
 * write moves the revision on; an accepted profile answers 409
 * `profile_not_editable`.
 */
import { processSyncQueue } from "../sync.command";
import {
  COACH_CLIENT_PROFILE_ENTITY,
  COACH_CLIENT_SETTINGS_ENTITY,
  COACH_CLIENT_SETUP_ENTITY,
  adoptProfileDetail,
  applyCoachClientConflict,
  applyCoachClientSyncSuccess,
  createProfileCommand,
  deleteProfileCommand,
  dismissProfileConflict,
  dismissSettingsConflict,
  invitedFromCache,
  patchSettingsCommand,
  reconcileInvitedProfiles,
  reconcileProfileDetail,
  reconcileSettings,
  resetSyncedProfileIdsForTest,
  resolveProfileId,
  saveSetupSectionCommand,
  updateProfileCommand,
} from "../coachClientProfiles.command";
import { saveFormCommand } from "../coachForms.command";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import { InMemoryAuthAdapter } from "@/adapters/auth/__tests__/in-memory-auth.adapter";
import type {
  CachedClientProfile,
  ClientProfileDetail,
  ClientSettings,
} from "@/domain/models/coachClientProfiles";
import type { SyncQueueEntry } from "@/domain/ports/storage.port";

jest.mock("@/lib/sentry", () => ({ captureSyncFailure: jest.fn() }));

const BASE = "https://api.test";
const USER = "coach-1";

const FIELDS = {
  displayName: "Lena Ortiz",
  contactEmail: "lena@example.com",
  contactPhone: null,
  goal: "First pull-up",
  privateNotes: null,
};

function detail(
  id: string,
  revision: number,
  extra: Partial<ClientProfileDetail> = {},
): ClientProfileDetail {
  return {
    id,
    ...FIELDS,
    status: "invited",
    clientId: null,
    relationshipId: null,
    acceptedAt: null,
    cancelledAt: null,
    revision,
    createdAt: "2026-11-27T09:00:00Z",
    updatedAt: "2026-11-27T09:00:00Z",
    setup: {},
    invite: null,
    ...extra,
  };
}

function settings(
  revision: number,
  extra: Partial<ClientSettings> = {},
): ClientSettings {
  return {
    relationshipId: "rel-1",
    clientId: "c1",
    trackTraining: false,
    trackCalories: false,
    sessionsPerWeek: null,
    features: {
      messages: true,
      checkIns: true,
      photos: true,
      habits: true,
      nutrition: true,
      resources: true,
    },
    alertMode: "default",
    revision,
    updatedAt: null,
    ...extra,
  };
}

type Call = {
  url: string;
  method: string;
  body: Record<string, unknown>;
  key?: string;
};

class FakeServer {
  profiles = new Map<string, ClientProfileDetail>();
  settings = new Map<string, ClientSettings>();
  keys = new Map<string, string>();
  calls: Call[] = [];
  offline = false;
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
    const reply = (status: number, json: unknown) => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => json,
      text: async () => JSON.stringify(json),
    });
    const path = url.slice(BASE.length);

    if (path === "/trainers/me/client-profiles" && init.method === "POST") {
      const known = key ? this.keys.get(key) : undefined;
      if (known) return reply(200, { data: this.profiles.get(known) });
      const id = `p-${++this.seq}`;
      if (key) this.keys.set(key, id);
      const p = detail(id, 1, body as Partial<ClientProfileDetail>);
      this.profiles.set(id, p);
      return reply(201, { data: p });
    }
    const settingsMatch = /^\/trainers\/me\/clients\/([^/]+)\/settings$/.exec(
      path,
    );
    if (settingsMatch) {
      const current = this.settings.get(settingsMatch[1]!)!;
      const { expectedRevision, ...patch } = body;
      if (
        expectedRevision !== undefined &&
        expectedRevision !== current.revision
      ) {
        return reply(409, { code: "revision_conflict", current });
      }
      const next = {
        ...current,
        ...patch,
        features: {
          ...current.features,
          ...((patch.features as object) ?? {}),
        },
        revision: current.revision + 1,
      } as ClientSettings;
      this.settings.set(current.clientId, next);
      return reply(200, { data: next });
    }
    const m =
      /^\/trainers\/me\/client-profiles\/([^/]+)(\/setup\/([a-z_]+))?$/.exec(
        path,
      );
    if (!m) return reply(404, { code: "not_found" });
    const p = this.profiles.get(m[1]!);
    if (!p) return reply(404, { code: "not_found" });
    if (init.method === "DELETE") {
      this.profiles.delete(p.id);
      return reply(204, null);
    }
    const { expectedRevision, items, ...fields } = body;
    if (expectedRevision !== undefined && expectedRevision !== p.revision) {
      return reply(409, { code: "revision_conflict", current: p });
    }
    if (p.status !== "invited") {
      return reply(409, { code: "profile_not_editable", status: p.status });
    }
    const next: ClientProfileDetail = m[3]
      ? {
          ...p,
          setup: { ...p.setup, [m[3]]: items as never },
          revision: p.revision + 1,
        }
      : { ...p, ...(fields as object), revision: p.revision + 1 };
    this.profiles.set(p.id, next);
    return reply(200, { data: next });
  };
}

let storage: InMemoryStorageAdapter;
let auth: InMemoryAuthAdapter;
let server: FakeServer;
let clock = Date.now();
const drain = () =>
  processSyncQueue(storage, auth, BASE, { now: () => (clock += 10 * 60_000) });
const queued = () => storage.getUncompletedMutations();
const deps = () => ({
  storage,
  userId: USER,
  now: () => new Date("2026-11-27T10:00:00Z"),
});
const cached = (id: string) => storage.getCachedCoachClientProfile(USER, id);

beforeEach(async () => {
  resetSyncedProfileIdsForTest();
  storage = new InMemoryStorageAdapter();
  await storage.initialize();
  auth = new InMemoryAuthAdapter();
  server = new FakeServer();
  (globalThis as Record<string, unknown>).fetch = jest.fn(server.fetch);
});

/** A profile already on the server and in the cache. */
function seed(id = "p-9", revision = 3): CachedClientProfile {
  const p = detail(id, revision);
  server.profiles.set(id, JSON.parse(JSON.stringify(p)) as ClientProfileDetail);
  storage.cacheCoachClientProfile(USER, { ...p, conflictAt: null });
  return { ...p, conflictAt: null };
}

describe("Who offline → replay (C11f, design A D6)", () => {
  it("makes the profile now, queues one keyed POST, then swaps to the server id", async () => {
    server.offline = true;
    const local = createProfileCommand(deps(), FIELDS);
    expect(local.id).toMatch(/^local-/);
    expect(local).toMatchObject({
      status: "invited",
      revision: 0,
      setup: {},
      invite: null,
    });
    expect(invitedFromCache(storage, USER).map((p) => p.id)).toEqual([
      local.id,
    ]);

    // Set-up and an edit made before it synced ride along.
    saveSetupSectionCommand(deps(), local.id, "welcome_message", [
      { refId: null, config: { text: "Hi Lena" }, sortOrder: 4 },
    ]);
    updateProfileCommand(deps(), local.id, { goal: "Strength base" });
    expect(queued().map((e) => [e.entityType, e.method])).toEqual([
      [COACH_CLIENT_PROFILE_ENTITY, "POST"],
      [COACH_CLIENT_SETUP_ENTITY, "PUT"],
    ]);
    // The edit folded into the unsent create.
    expect(JSON.parse(queued()[0]!.payload)).toMatchObject({
      goal: "Strength base",
    });

    await drain();
    expect(queued()).toHaveLength(2);
    server.offline = false;
    await drain();
    await drain();

    expect(queued()).toHaveLength(0);
    const id = resolveProfileId(local.id);
    expect(id).toBe("p-1");
    expect(cached(local.id)).toBeNull();
    expect(cached(id)).toMatchObject({
      goal: "Strength base",
      revision: 2,
      setup: {
        welcome_message: [{ config: { text: "Hi Lena" }, sortOrder: 0 }],
      },
    });
    const posts = server.calls.filter((c) => c.method === "POST");
    expect(new Set(posts.map((c) => c.key)).size).toBe(1);
    // The PUT waited for the server id and was rebased from 0 to 1.
    const put = server.calls.find(
      (c) => c.method === "PUT" && c.url.includes("/p-1/"),
    );
    expect(put?.body).toMatchObject({ expectedRevision: 1 });
  });

  it("an edit after sync goes as its own PATCH with the revision the phone has", async () => {
    seed("p-9", 3);
    updateProfileCommand(deps(), "p-9", {
      goal: "Pull-ups",
      privateNotes: "Knee",
    });
    updateProfileCommand(deps(), "p-9", { goal: "Pull-ups x5" });
    expect(queued()).toHaveLength(1);
    expect(JSON.parse(queued()[0]!.payload)).toEqual({
      goal: "Pull-ups x5",
      privateNotes: "Knee",
      expectedRevision: 3,
    });
    expect(updateProfileCommand(deps(), "nope", { goal: "x" })).toBeNull();
    // Nothing changed: cached, nothing queued.
    updateProfileCommand(deps(), "p-9", {});
    expect(queued()).toHaveLength(1);
    await drain();
    expect(cached("p-9")).toMatchObject({ goal: "Pull-ups x5", revision: 4 });
  });
});

describe("set-up sections (C11l–r)", () => {
  it("keeps the latest write per section and chains revisions across sections", async () => {
    seed("p-9", 3);
    saveSetupSectionCommand(deps(), "p-9", "starter_form", [
      { refId: "f-1", config: {}, sortOrder: 0 },
    ]);
    saveSetupSectionCommand(deps(), "p-9", "starter_form", [
      { refId: "f-2", config: {}, sortOrder: 0 },
      { refId: "f-1", config: {}, sortOrder: 1 },
    ]);
    saveSetupSectionCommand(deps(), "p-9", "resource", [
      { refId: "r-1", config: {}, sortOrder: 0 },
    ]);
    expect(queued()).toHaveLength(2);
    expect(cached("p-9")?.setup.starter_form?.map((i) => i.refId)).toEqual([
      "f-2",
      "f-1",
    ]);

    await drain();
    expect(queued()).toHaveLength(0);
    // Starter forms went at 3 → 4; resources were rebased to 4 → 5.
    const puts = server.calls.filter((c) => c.method === "PUT");
    expect(puts.map((c) => c.body.expectedRevision)).toEqual([3, 4]);
    expect(cached("p-9")?.revision).toBe(5);
  });

  it("an emptied section is removed from the cache and sent as no items", async () => {
    seed("p-9", 3);
    saveSetupSectionCommand(deps(), "p-9", "meal_plan", [
      { refId: "pl-1", config: {}, sortOrder: 0 },
    ]);
    await drain();
    saveSetupSectionCommand(deps(), "p-9", "meal_plan", []);
    expect(cached("p-9")?.setup.meal_plan).toBeUndefined();
    expect(JSON.parse(queued()[0]!.payload)).toEqual({
      items: [],
      expectedRevision: 4,
    });
    expect(saveSetupSectionCommand(deps(), "nope", "meal_plan", [])).toBeNull();
  });

  it("remaps an offline form's local id in queued and cached set-up items", async () => {
    seed("p-9", 3);
    server.offline = true;
    const form = saveFormCommand(
      { storage, userId: USER },
      {
        title: "Goals",
        description: null,
        questions: [
          { id: "q1", type: "short_text", prompt: "Why?", required: true },
        ],
      },
    );
    saveSetupSectionCommand(deps(), "p-9", "starter_form", [
      { refId: form.id, config: {}, sortOrder: 0 },
    ]);
    storage.swapLocalCoachFormId(USER, form.id, "f-server");
    const put = queued().find(
      (e) => e.entityType === COACH_CLIENT_SETUP_ENTITY,
    )!;
    expect(JSON.parse(put.payload).items[0].refId).toBe("f-server");
    expect(cached("p-9")?.setup.starter_form?.[0]?.refId).toBe("f-server");
    // Plans and send rules remap the same way.
    storage.remapCoachClientSetupRefs("f-server", "f-server");
    storage.swapLocalNutritionPlanId("f-server", "pl-x");
    expect(cached("p-9")?.setup.starter_form?.[0]?.refId).toBe("pl-x");
    storage.swapLocalCoachFormScheduleId(USER, "pl-x", "s-y");
    expect(cached("p-9")?.setup.starter_form?.[0]?.refId).toBe("s-y");
  });
});

describe("409 conflicts: updated on another device", () => {
  it("takes the server copy, drops this phone's queued writes and says so", async () => {
    seed("p-9", 3);
    server.profiles.set("p-9", detail("p-9", 5, { goal: "From the web" }));
    updateProfileCommand(deps(), "p-9", { goal: "From the phone" });
    saveSetupSectionCommand(deps(), "p-9", "resource", [
      { refId: "r-1", config: {}, sortOrder: 0 },
    ]);
    await drain();
    expect(queued()).toHaveLength(0);
    expect(cached("p-9")).toMatchObject({
      goal: "From the web",
      revision: 5,
      conflictAt: expect.any(String),
    });
    dismissProfileConflict(deps(), "p-9");
    expect(cached("p-9")?.conflictAt).toBeNull();
    // Dismissing again (or an unknown profile) is a no-op.
    dismissProfileConflict(deps(), "p-9");
    dismissProfileConflict(deps(), "nope");
  });

  it("an accepted client stops edits: queued writes dropped, status taken", async () => {
    seed("p-9", 3);
    server.profiles.set(
      "p-9",
      detail("p-9", 3, { status: "active", clientId: "c-1" }),
    );
    saveSetupSectionCommand(deps(), "p-9", "resource", [
      { refId: "r-1", config: {}, sortOrder: 0 },
    ]);
    await drain();
    expect(queued()).toHaveLength(0);
    expect(cached("p-9")?.status).toBe("active");
  });

  it("ignores bodies it doesn't recognise", () => {
    const entry = {
      id: 1,
      entityType: COACH_CLIENT_PROFILE_ENTITY,
      entityId: `${USER}:p-9`,
      method: "PATCH",
    } as SyncQueueEntry;
    expect(applyCoachClientConflict(storage, entry, "not json")).toBe(false);
    expect(applyCoachClientConflict(storage, entry, '{"code":"other"}')).toBe(
      false,
    );
    expect(
      applyCoachClientConflict(storage, { ...entry, entityId: "" }, "{}"),
    ).toBe(false);
    expect(
      applyCoachClientConflict(
        storage,
        {
          ...entry,
          entityType: COACH_CLIENT_SETTINGS_ENTITY,
          entityId: `${USER}:c1`,
        },
        '{"code":"revision_conflict","current":{}}',
      ),
    ).toBe(false);
    expect(
      applyCoachClientConflict(
        storage,
        { ...entry, entityId: `${USER}:` },
        '{"code":"x"}',
      ),
    ).toBe(false);
  });
});

describe("delete (C11f Cancel on a new client)", () => {
  it("a profile only on this phone is never sent", () => {
    server.offline = true;
    const local = createProfileCommand(deps(), FIELDS);
    saveSetupSectionCommand(deps(), local.id, "resource", [
      { refId: "r-1", config: {}, sortOrder: 0 },
    ]);
    deleteProfileCommand(deps(), local.id);
    expect(queued()).toHaveLength(0);
    expect(cached(local.id)).toBeNull();
  });

  it("a synced profile queues a DELETE and leaves the cache", async () => {
    seed("p-9", 3);
    updateProfileCommand(deps(), "p-9", { goal: "x" });
    deleteProfileCommand(deps(), "p-9");
    expect(queued().map((e) => e.method)).toEqual(["DELETE"]);
    await drain();
    expect(server.profiles.has("p-9")).toBe(false);
    expect(cached("p-9")).toBeNull();
  });

  it("a create already sent keeps going so the DELETE gets its server id", async () => {
    server.offline = true;
    const local = createProfileCommand(deps(), FIELDS);
    await drain(); // dispatched, no answer
    deleteProfileCommand(deps(), local.id);
    expect(queued().map((e) => e.method)).toEqual(["POST", "DELETE"]);
    server.offline = false;
    await drain();
    await drain();
    expect(queued()).toHaveLength(0);
    expect(server.profiles.size).toBe(0);
    expect(cached("p-1")).toBeNull();
  });
});

describe("reads never overwrite a queued write", () => {
  it("the invited list keeps set-up, drops profiles that left, keeps local ones", () => {
    seed("p-9", 3);
    storage.cacheCoachClientProfile(USER, {
      ...detail("p-9", 3, {
        setup: { resource: [{ refId: "r", config: {}, sortOrder: 0 }] },
      }),
    });
    seed("p-gone", 1);
    server.offline = true;
    const local = createProfileCommand(deps(), FIELDS);
    seed("p-queued", 2);
    updateProfileCommand(deps(), "p-queued", { goal: "mine" });

    const rows = reconcileInvitedProfiles(storage, USER, [
      detail("p-9", 4, { goal: "server" }),
      detail("p-queued", 9, { goal: "server" }),
    ]);
    expect(rows.map((p) => p.id).sort()).toEqual(
      [local.id, "p-9", "p-queued"].sort(),
    );
    expect(cached("p-9")).toMatchObject({
      revision: 4,
      setup: { resource: [{ refId: "r" }] },
    });
    expect(cached("p-queued")?.goal).toBe("mine");
    expect(cached("p-gone")).toBeNull();
  });

  it("detail: the phone's edits win while queued; the server's code and status show", () => {
    seed("p-9", 3);
    updateProfileCommand(deps(), "p-9", { goal: "mine" });
    const invite = {
      code: "LN4Q8T",
      link: "l",
      expiresAt: "2026-12-04T00:00:00Z",
      status: "active" as const,
    };
    const kept = reconcileProfileDetail(
      storage,
      USER,
      detail("p-9", 4, { goal: "server", invite }),
    );
    expect(kept).toMatchObject({ goal: "mine", invite });
    storage.discardEntries(queued().map((e) => e.id));
    expect(
      reconcileProfileDetail(
        storage,
        USER,
        detail("p-9", 4, { goal: "server" }),
      ).goal,
    ).toBe("server");
  });

  it("adopts an online answer (copy-from, invite) and keeps a shown conflict", () => {
    storage.cacheCoachClientProfile(USER, {
      ...detail("p-9", 3),
      conflictAt: "t",
    });
    adoptProfileDetail(deps(), detail("p-9", 6));
    expect(cached("p-9")).toMatchObject({ revision: 6, conflictAt: "t" });
    adoptProfileDetail(deps(), detail("p-new", 1));
    expect(cached("p-new")?.conflictAt).toBeNull();
  });
});

describe("C3.9 settings", () => {
  beforeEach(() => {
    server.settings.set("c1", settings(2));
    storage.cacheCoachClientSettings(USER, "c1", {
      ...settings(2),
      conflictAt: null,
    });
  });

  it("caches each switch now and folds them into one PATCH", async () => {
    patchSettingsCommand(deps(), "c1", { features: { photos: false } });
    patchSettingsCommand(deps(), "c1", {
      trackTraining: true,
      sessionsPerWeek: 3,
    });
    patchSettingsCommand(deps(), "c1", { features: { habits: false } });
    expect(queued()).toHaveLength(1);
    expect(JSON.parse(queued()[0]!.payload)).toEqual({
      features: { photos: false, habits: false },
      trackTraining: true,
      sessionsPerWeek: 3,
      expectedRevision: 2,
    });
    expect(
      storage.getCachedCoachClientSettings(USER, "c1")?.features.photos,
    ).toBe(false);
    await drain();
    expect(storage.getCachedCoachClientSettings(USER, "c1")).toMatchObject({
      revision: 3,
      trackTraining: true,
      conflictAt: null,
    });
    expect(patchSettingsCommand(deps(), "nope", {})).toBeNull();
  });

  it("a later change made while one is in flight is rebased, not a conflict", () => {
    patchSettingsCommand(deps(), "c1", { alertMode: "mute" });
    const first = queued()[0]!;
    storage.markMutationInFlight(first.id);
    storage.markMutationDispatched(first.id);
    patchSettingsCommand(deps(), "c1", { alertMode: "everything" });
    expect(queued()).toHaveLength(2);
    applyCoachClientSyncSuccess(
      storage,
      first,
      settings(3, { alertMode: "mute" }),
    );
    const second = queued().find((e) => e.id !== first.id)!;
    expect(JSON.parse(second.payload).expectedRevision).toBe(3);
    // The cache keeps the newer choice, with the server's revision.
    expect(storage.getCachedCoachClientSettings(USER, "c1")).toMatchObject({
      alertMode: "everything",
      revision: 3,
    });
  });

  it("409: shows the server's settings and drops the queued change", async () => {
    server.settings.set("c1", settings(7, { trackCalories: true }));
    patchSettingsCommand(deps(), "c1", { features: { photos: false } });
    await drain();
    expect(queued()).toHaveLength(0);
    expect(storage.getCachedCoachClientSettings(USER, "c1")).toMatchObject({
      revision: 7,
      trackCalories: true,
      conflictAt: expect.any(String),
    });
    dismissSettingsConflict(deps(), "c1");
    expect(
      storage.getCachedCoachClientSettings(USER, "c1")?.conflictAt,
    ).toBeNull();
    dismissSettingsConflict(deps(), "c1");
  });

  it("reconcile keeps the phone's copy while a change is queued", () => {
    patchSettingsCommand(deps(), "c1", { trackCalories: true });
    expect(
      reconcileSettings(storage, USER, "c1", settings(9)).trackCalories,
    ).toBe(true);
    storage.discardEntries(queued().map((e) => e.id));
    expect(reconcileSettings(storage, USER, "c1", settings(9))).toMatchObject({
      revision: 9,
      conflictAt: null,
    });
  });
});

describe("sync success edge cases", () => {
  it("ignores answers without a user, an id or a revision", () => {
    const base = {
      id: 1,
      entityType: COACH_CLIENT_PROFILE_ENTITY,
      entityId: `${USER}:p-9`,
      method: "PATCH",
      payload: "{}",
    } as SyncQueueEntry;
    seed("p-9", 3);
    applyCoachClientSyncSuccess(
      storage,
      { ...base, entityId: "" },
      detail("p-9", 9),
    );
    applyCoachClientSyncSuccess(storage, base, { id: "p-9" });
    applyCoachClientSyncSuccess(
      storage,
      { ...base, entityId: `${USER}:` },
      detail("p-9", 9),
    );
    applyCoachClientSyncSuccess(
      storage,
      {
        ...base,
        entityType: COACH_CLIENT_SETTINGS_ENTITY,
        entityId: `${USER}:c1`,
      },
      { revision: "x" },
    );
    applyCoachClientSyncSuccess(
      storage,
      {
        ...base,
        entityType: COACH_CLIENT_SETTINGS_ENTITY,
        entityId: `${USER}:`,
      },
      null,
    );
    expect(cached("p-9")?.revision).toBe(3);
  });
});
