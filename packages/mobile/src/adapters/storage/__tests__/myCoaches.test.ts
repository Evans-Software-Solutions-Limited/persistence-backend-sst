/** @jest-environment node */
import { DatabaseSync } from "node:sqlite";
import type { StoragePort } from "@/domain/ports/storage.port";
import type { MyCoach, MyCoaching } from "@/domain/models/myCoaching";
import { InMemoryStorageAdapter } from "./in-memory-storage.adapter";
import { SQLiteStorageAdapter } from "../sqlite.adapter";

/** The SQLite adapter on node's SQLite, with the PER-126 DDL it ships. */
function sqliteAdapter(): StoragePort {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE cached_my_coaches (
      user_id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      synced_at TEXT NOT NULL
    );
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
  return adapter;
}

const coach = (id: string, name: string): MyCoach => ({
  relationshipId: id,
  trainerId: `t-${id}`,
  name,
  avatarUrl: null,
  since: "2026-08-04T09:00:00Z",
  features: {
    nutrition: true,
    checkIns: true,
    photos: false,
    habits: true,
    messages: true,
    resources: true,
  },
  due: { forms: 1 },
  newPlans: 0,
  resources: 2,
});

const TWO: MyCoaching = {
  coaches: [coach("r1", "Ellie Hart"), coach("r2", "Marcus Lee")],
  asOf: "2026-11-23T09:00:00Z",
};

describe.each([
  ["SQLite", sqliteAdapter],
  ["in-memory", () => new InMemoryStorageAdapter() as StoragePort],
])("cached_my_coaches (%s)", (_name, make) => {
  it("is null until cached, then round-trips per user", () => {
    const s = make();
    expect(s.getCachedMyCoaches("u1")).toBeNull();
    s.cacheMyCoaches("u1", TWO);
    expect(s.getCachedMyCoaches("u1")).toEqual(TWO);
    expect(s.getCachedMyCoaches("u2")).toBeNull();
  });

  it("a newer read replaces the older one", () => {
    const s = make();
    s.cacheMyCoaches("u1", TWO);
    const one = {
      coaches: [coach("r1", "Ellie Hart")],
      asOf: "2026-11-24T09:00:00Z",
    };
    s.cacheMyCoaches("u1", one);
    expect(s.getCachedMyCoaches("u1")).toEqual(one);
  });

  it("leaving one coach drops only that coach", () => {
    const s = make();
    s.cacheMyCoaches("u1", TWO);
    s.removeCachedMyCoach("u1", "r2");
    expect(s.getCachedMyCoaches("u1")?.coaches.map((c) => c.name)).toEqual([
      "Ellie Hart",
    ]);
    // Nothing cached yet: a no-op, not an empty row.
    s.removeCachedMyCoach("u2", "r1");
    expect(s.getCachedMyCoaches("u2")).toBeNull();
  });
});

it("the in-memory adapter clears the cache on sign-out", () => {
  const s = new InMemoryStorageAdapter();
  s.cacheMyCoaches("u1", TWO);
  s.clearAll();
  expect(s.getCachedMyCoaches("u1")).toBeNull();
});
