/** @jest-environment node */
import { DatabaseSync } from "node:sqlite";
import type { StoragePort } from "@/domain/ports/storage.port";
import type {
  CachedClientProfile,
  CachedClientSettings,
} from "@/domain/models/coachClientProfiles";
import { InMemoryStorageAdapter } from "./in-memory-storage.adapter";
import { SQLiteStorageAdapter } from "../sqlite.adapter";

/** The SQLite adapter on node's SQLite, with the PER-125 DDL it ships. */
function sqliteAdapter(): { adapter: StoragePort; db: DatabaseSync } {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE cached_coach_client_profiles (user_id TEXT NOT NULL, profile_id TEXT NOT NULL, payload TEXT NOT NULL, synced_at TEXT NOT NULL, PRIMARY KEY (user_id, profile_id));
    CREATE TABLE cached_coach_client_settings (user_id TEXT NOT NULL, client_id TEXT NOT NULL, payload TEXT NOT NULL, synced_at TEXT NOT NULL, PRIMARY KEY (user_id, client_id));
    CREATE TABLE sync_queue (id INTEGER PRIMARY KEY, entity_type TEXT, entity_id TEXT, endpoint TEXT, payload TEXT, status TEXT);
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

const profile = (id: string, refId = "f-1"): CachedClientProfile => ({
  id,
  displayName: "Lena Ortiz",
  contactEmail: null,
  contactPhone: null,
  goal: null,
  privateNotes: null,
  status: "invited",
  clientId: null,
  relationshipId: null,
  acceptedAt: null,
  cancelledAt: null,
  revision: 1,
  createdAt: "2026-11-27T09:00:00Z",
  updatedAt: "2026-11-27T09:00:00Z",
  setup: { starter_form: [{ refId, config: {}, sortOrder: 0 }] },
  invite: null,
  conflictAt: null,
});

const settings: CachedClientSettings = {
  relationshipId: "rel",
  clientId: "c1",
  trackTraining: true,
  trackCalories: false,
  sessionsPerWeek: 3,
  features: {
    messages: true,
    checkIns: true,
    photos: false,
    habits: true,
    nutrition: true,
    resources: true,
  },
  alertMode: "mute",
  revision: 4,
  updatedAt: null,
  conflictAt: null,
};

describe.each([
  ["SQLite", () => sqliteAdapter().adapter],
  ["in-memory", () => new InMemoryStorageAdapter() as StoragePort],
])("PER-125 caches (%s)", (_name, make) => {
  it("keeps one row per profile and per client's settings, per coach", () => {
    const s = make();
    s.cacheCoachClientProfile("u1", profile("p-1"));
    s.cacheCoachClientProfile("u1", { ...profile("p-1"), goal: "Pull-up" });
    s.cacheCoachClientProfile("u1", profile("p-2"));
    s.cacheCoachClientProfile("u2", profile("p-3"));
    expect(
      s
        .getCachedCoachClientProfiles("u1")
        .map((p) => p.id)
        .sort(),
    ).toEqual(["p-1", "p-2"]);
    expect(s.getCachedCoachClientProfile("u1", "p-1")?.goal).toBe("Pull-up");
    expect(s.getCachedCoachClientProfile("u1", "p-3")).toBeNull();
    s.removeCachedCoachClientProfile("u1", "p-2");
    expect(s.getCachedCoachClientProfile("u1", "p-2")).toBeNull();

    expect(s.getCachedCoachClientSettings("u1", "c1")).toBeNull();
    s.cacheCoachClientSettings("u1", "c1", settings);
    expect(s.getCachedCoachClientSettings("u1", "c1")).toEqual(settings);
  });
});

describe("queued rows follow a synced profile's id", () => {
  it.each([
    ["SQLite", true],
    ["in-memory", false],
  ])(
    "%s swaps the profile id in the cache and in profile/set-up/settings rows",
    (_n, sqlite) => {
      let s: StoragePort;
      let rows: () => {
        entity_type: string;
        entity_id: string;
        endpoint: string;
        payload: string;
        status: string;
      }[];
      if (sqlite) {
        const { adapter, db } = sqliteAdapter();
        s = adapter;
        const insert = db.prepare(
          "INSERT INTO sync_queue (entity_type, entity_id, endpoint, payload, status) VALUES (?, ?, ?, ?, ?)",
        );
        insert.run(
          "coach_client_profile",
          "u1:local-a",
          "/trainers/me/client-profiles",
          "{}",
          "pending",
        );
        insert.run(
          "coach_client_setup",
          "u1:local-a:resource",
          "/trainers/me/client-profiles/local-a/setup/resource",
          '{"items":[{"refId":"local-f"}]}',
          "pending",
        );
        insert.run(
          "coach_client_setup",
          "u1:local-a:resource",
          "/trainers/me/client-profiles/local-a/setup/resource",
          "{}",
          "completed",
        );
        insert.run("other", "u1:local-a", "/x/local-a", "{}", "pending");
        rows = () =>
          db.prepare("SELECT * FROM sync_queue ORDER BY id").all() as never;
      } else {
        const mem = new InMemoryStorageAdapter();
        s = mem;
        mem.enqueueMutation({
          entityType: "coach_client_profile",
          entityId: "u1:local-a",
          operation: "create",
          payload: {},
          endpoint: "/trainers/me/client-profiles",
          method: "POST",
        });
        mem.enqueueMutation({
          entityType: "coach_client_setup",
          entityId: "u1:local-a:resource",
          operation: "update",
          payload: { items: [{ refId: "local-f" }] },
          endpoint: "/trainers/me/client-profiles/local-a/setup/resource",
          method: "PUT",
        });
        mem.enqueueMutation({
          entityType: "other",
          entityId: "u1:local-a",
          operation: "update",
          payload: {},
          endpoint: "/x/local-a",
          method: "PUT",
        });
        rows = () =>
          mem.getUncompletedMutations().map((e) => ({
            entity_type: e.entityType,
            entity_id: e.entityId!,
            endpoint: e.endpoint,
            payload: e.payload,
            status: e.status,
          }));
      }
      s.cacheCoachClientProfile("u1", profile("local-a", "local-f"));
      s.swapLocalCoachClientProfileId("u1", "local-a", "p-1");
      s.swapLocalCoachClientProfileId("u1", "same", "same");
      expect(s.getCachedCoachClientProfile("u1", "local-a")).toBeNull();
      expect(s.getCachedCoachClientProfile("u1", "p-1")?.id).toBe("p-1");
      const live = rows().filter((r) => r.status !== "completed");
      expect(
        live.find((r) => r.entity_type === "coach_client_setup"),
      ).toMatchObject({
        entity_id: "u1:p-1:resource",
        endpoint: "/trainers/me/client-profiles/p-1/setup/resource",
      });
      // Other features' rows are left alone.
      expect(live.find((r) => r.entity_type === "other")?.endpoint).toBe(
        "/x/local-a",
      );

      // An offline form's id in set-up items follows its create too.
      s.remapCoachClientSetupRefs("local-f", "f-9");
      s.remapCoachClientSetupRefs("x", "x");
      expect(
        s.getCachedCoachClientProfile("u1", "p-1")?.setup.starter_form?.[0]
          ?.refId,
      ).toBe("f-9");
      expect(
        rows().find(
          (r) =>
            r.entity_type === "coach_client_setup" && r.status !== "completed",
        )?.payload,
      ).toContain('"refId":"f-9"');
    },
  );
});
