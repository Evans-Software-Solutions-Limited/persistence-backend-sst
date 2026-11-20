/** @jest-environment node */
import { DatabaseSync } from "node:sqlite";
import type { StoragePort } from "@/domain/ports/storage.port";
import type { WorkoutSession } from "@/domain/models/session";
import { session } from "@/domain/services/__tests__/youFixtures";
import { InMemoryStorageAdapter } from "./in-memory-storage.adapter";
import { SQLiteStorageAdapter } from "../sqlite.adapter";

/** The SQLite adapter on node's SQLite, with the training-log DDL it ships. */
function sqliteAdapter(): { adapter: StoragePort; db: DatabaseSync } {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE training_log (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      started_at TEXT NOT NULL,
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE training_log_since (user_id TEXT PRIMARY KEY, since TEXT NOT NULL);
    CREATE TABLE training_log_ids (local_id TEXT PRIMARY KEY, server_id TEXT NOT NULL);
    CREATE TABLE training_log_records (session_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, payload TEXT NOT NULL);
    CREATE TABLE record_responses (user_id TEXT PRIMARY KEY, payload TEXT NOT NULL, cached_at TEXT NOT NULL);
    CREATE TABLE active_sessions (id TEXT PRIMARY KEY);
    CREATE TABLE session_exercises (session_id TEXT);
    CREATE TABLE personal_records (session_id TEXT);
  `);
  type P = (string | number | null)[];
  const adapter = new SQLiteStorageAdapter();
  Object.assign(adapter, {
    db: {
      getAllSync: (q: string, p: P) => db.prepare(q).all(...p),
      getFirstSync: (q: string, p: P) => db.prepare(q).get(...p) ?? null,
      runSync: (q: string, p: P) => db.prepare(q).run(...p),
      execSync: (q: string) => {
        if (!q.startsWith("PRAGMA")) db.exec(q);
      },
      withTransactionSync: (fn: () => void) => fn(),
    },
  });
  return { adapter, db };
}

const finished = (
  id: string,
  day: number,
  extra: Partial<WorkoutSession> = {},
) =>
  session(
    id,
    new Date(Date.UTC(2026, 9, day, 7)).toISOString(),
    {
      bench: [[100, 5]],
    },
    extra,
  );

describe.each([
  ["SQLite", () => sqliteAdapter().adapter],
  ["in-memory", () => new InMemoryStorageAdapter() as StoragePort],
])("training log (%s)", (_name, make) => {
  let s: StoragePort;
  beforeEach(() => {
    s = make();
  });

  it("keeps finished workouts only, oldest first, filtered by range", () => {
    s.saveTrainingLogEntry("u1", finished("b", 27));
    s.saveTrainingLogEntry("u1", finished("a", 20));
    s.saveTrainingLogEntry("u1", finished("c", 28, { status: "cancelled" }));
    s.saveTrainingLogEntry(
      "u1",
      finished("d", 28, {
        withClient: { id: "client", name: "Lena", initials: "L" },
      }),
    );
    expect(s.getTrainingLog("u1").map((x) => x.id)).toEqual(["a", "b"]);
    expect(
      s.getTrainingLog("u1", { from: "2026-10-21T00:00:00Z" }).map((x) => x.id),
    ).toEqual(["b"]);
    expect(
      s.getTrainingLog("u1", { to: "2026-10-21T00:00:00Z" }).map((x) => x.id),
    ).toEqual(["a"]);
  });

  it("upserts by id and returns the full session", () => {
    s.saveTrainingLogEntry("u1", finished("a", 20));
    s.saveTrainingLogEntry("u1", finished("a", 20, { name: "Upper A" }));
    expect(s.getTrainingLog("u1")).toHaveLength(1);
    const entry = s.getTrainingLogEntry("u1", "a")!;
    expect(entry.name).toBe("Upper A");
    expect(entry.exercises[0]!.sets[0]!.weightKg).toBe(100);
    expect(s.getTrainingLogEntry("u1", "missing")).toBeNull();
  });

  it("never shows or overwrites another user's workouts", () => {
    s.saveTrainingLogEntry("u1", finished("a", 20, { name: "Mine" }));
    s.saveTrainingLogEntry("u2", finished("a", 20, { name: "Theirs" }));
    expect(s.getTrainingLog("u2")).toEqual([]);
    expect(s.getTrainingLogEntry("u2", "a")).toBeNull();
    expect(s.getTrainingLogEntry("u1", "a")!.name).toBe("Mine");
  });

  it("renames a workout to its server id", () => {
    s.saveTrainingLogEntry("u1", finished("local-1", 20));
    s.swapLocalSessionId("local-1", "srv-1");
    expect(s.getTrainingLogEntry("u1", "local-1")).toBeNull();
    const entry = s.getTrainingLogEntry("u1", "srv-1")!;
    expect(entry.id).toBe("srv-1");
    expect(entry.exercises[0]!.sessionId).toBe("srv-1");
    // A swap with nothing logged is harmless.
    s.swapLocalSessionId("local-2", "srv-2");
    expect(s.getTrainingLog("u1")).toHaveLength(1);
  });

  it("moves a synced workout to its server id, whichever comes first (Inspector Brad #541)", () => {
    // Summary saved first, then the sync reply links the ids.
    s.saveTrainingLogEntry("u1", finished("local-1", 20));
    s.linkTrainingLogSessionId("local-1", "srv-1");
    expect(s.getTrainingLogEntry("u1", "local-1")).toBeNull();
    expect(s.getTrainingLogEntry("u1", "srv-1")!.exercises[0]!.sessionId).toBe(
      "srv-1",
    );
    // The sync drained before the summary saved: it still lands as srv-2.
    s.linkTrainingLogSessionId("local-2", "srv-2");
    s.saveTrainingLogEntry("u1", finished("local-2", 21));
    expect(s.getTrainingLogEntry("u1", "local-2")).toBeNull();
    expect(s.getTrainingLogEntry("u1", "srv-2")!.id).toBe("srv-2");
    // A re-save under the old id never duplicates.
    s.saveTrainingLogEntry("u1", finished("local-1", 20));
    expect(s.getTrainingLog("u1").map((x) => x.id)).toEqual(["srv-1", "srv-2"]);
    // Same id both sides is a no-op.
    s.linkTrainingLogSessionId("srv-1", "srv-1");
    expect(s.getTrainingLogEntry("u1", "srv-1")).not.toBeNull();
  });

  it("keeps a Together workout under its confirmed server id (Inspector Brad #541)", () => {
    s.saveTrainingLogEntry(
      "u1",
      finished("local-t", 22, {
        together: { sessionId: "t", executionId: "x", historyId: "srv-t" },
      }),
    );
    expect(s.getTrainingLogEntry("u1", "local-t")).toBeNull();
    const entry = s.getTrainingLogEntry("u1", "srv-t")!;
    expect(entry.id).toBe("srv-t");
    expect(entry.exercises[0]!.sessionId).toBe("srv-t");
    // Not yet confirmed: stays local until a link arrives.
    s.saveTrainingLogEntry(
      "u1",
      finished("local-u", 23, {
        together: { sessionId: "t", executionId: "y" },
      }),
    );
    expect(s.getTrainingLogEntry("u1", "local-u")).not.toBeNull();
  });

  it("pulls the log's start back to its earliest workout (Inspector Brad #541)", () => {
    // Finished on the 18th; no screen had read the log yet.
    s.saveTrainingLogEntry("u1", finished("a", 18));
    expect(s.getTrainingLogSince("u1")).toBe(finished("a", 18).startedAt);
    // Opening You on the 20th doesn't move it later.
    s.markTrainingLogSince("u1", "2026-10-20T10:00:00.000Z");
    expect(s.getTrainingLogSince("u1")).toBe(finished("a", 18).startedAt);
    // A later workout leaves it; an earlier live finish moves it back.
    s.saveTrainingLogEntry("u1", finished("b", 22));
    expect(s.getTrainingLogSince("u1")).toBe(finished("a", 18).startedAt);
    s.saveTrainingLogEntry("u1", finished("c", 10));
    expect(s.getTrainingLogSince("u1")).toBe(finished("c", 10).startedAt);
    // An unfinished workout never moves it.
    s.saveTrainingLogEntry("u1", finished("d", 1, { status: "cancelled" }));
    expect(s.getTrainingLogSince("u1")).toBe(finished("c", 10).startedAt);
  });

  it("never moves the start back for a back-dated workout (Inspector Brad #541)", () => {
    jest.useFakeTimers({ now: new Date("2026-11-21T09:00:00.000Z") });
    try {
      // The day after the update, a forgotten workout is logged for 3 Aug.
      s.saveTrainingLogEntry(
        "u1",
        finished("retro", 3, {
          startedAt: "2026-08-03T07:00:00.000Z",
          retrospectiveCompletedAt: "2026-08-03T08:00:00.000Z",
        }),
      );
      // The log starts when it was logged, not on 3 Aug.
      expect(s.getTrainingLogSince("u1")).toBe("2026-11-21T09:00:00.000Z");
      // And a back-dated workout never pulls an existing start back.
      s.saveTrainingLogEntry(
        "u1",
        finished("retro2", 1, {
          startedAt: "2026-07-01T07:00:00.000Z",
          retrospectiveCompletedAt: "2026-07-01T08:00:00.000Z",
        }),
      );
      expect(s.getTrainingLogSince("u1")).toBe("2026-11-21T09:00:00.000Z");
      // The workouts themselves are still in the log on their own dates.
      expect(s.getTrainingLogEntry("u1", "retro")!.startedAt).toBe(
        "2026-08-03T07:00:00.000Z",
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it("keeps every workout's own records, even for a lift beaten twice (Inspector Brad #541)", () => {
    const pr = (newValue: number) => ({
      exerciseId: "bench",
      exerciseName: "Bench",
      recordType: "max_weight" as const,
      newValue,
      previousValue: newValue - 5,
      setId: "set",
    });
    const respond = (
      localSessionId: string,
      records: ReturnType<typeof pr>[],
    ) =>
      s.cacheRecordResponse("u1", {
        localSessionId,
        personalRecords: records,
        workoutsThisMonth: 1,
        cachedAt: "x",
      });
    // 3 Oct: summary saves, then the sync reply caches records and links ids.
    s.saveTrainingLogEntry("u1", finished("local-a", 3));
    respond("local-a", [pr(100)]);
    s.linkTrainingLogSessionId("local-a", "srv-a");
    // 24 Oct: the same lift beaten again.
    s.saveTrainingLogEntry("u1", finished("local-b", 24));
    respond("local-b", [pr(105)]);
    s.linkTrainingLogSessionId("local-b", "srv-b");
    // A Together workout: its response names the local id, the log keeps
    // the confirmed history id.
    s.saveTrainingLogEntry(
      "u1",
      finished("local-t", 25, {
        together: { sessionId: "t", executionId: "x", historyId: "srv-t" },
      }),
    );
    respond("local-t", [pr(110)]);

    const got = s.getTrainingLogRecords("u1", [
      "srv-a",
      "srv-b",
      "srv-t",
      "none",
    ]);
    expect(got["srv-a"]!.map((r) => r.newValue)).toEqual([100]);
    expect(got["srv-b"]!.map((r) => r.newValue)).toEqual([105]);
    expect(got["srv-t"]!.map((r) => r.newValue)).toEqual([110]);
    expect(got.none).toBeUndefined();
    // Never another user's records.
    expect(s.getTrainingLogRecords("u2", ["srv-a"])).toEqual({});
    expect(s.getTrainingLogRecords("u1", [])).toEqual({});
  });

  it("stamps when the log started, once", () => {
    expect(s.getTrainingLogSince("u1")).toBeNull();
    s.markTrainingLogSince("u1", "2026-11-20T10:00:00Z");
    s.markTrainingLogSince("u1", "2026-11-25T10:00:00Z");
    expect(s.getTrainingLogSince("u1")).toBe("2026-11-20T10:00:00Z");
    expect(s.getTrainingLogSince("u2")).toBeNull();
  });
});

it("clears the in-memory log on sign-out", () => {
  const s = new InMemoryStorageAdapter();
  s.saveTrainingLogEntry("u1", finished("a", 20));
  s.markTrainingLogSince("u1", "2026-11-20T10:00:00Z");
  s.clearAll();
  expect(s.getTrainingLog("u1")).toEqual([]);
  expect(s.getTrainingLogSince("u1")).toBeNull();
});

it("bounds the read in SQL: rows outside the window are never parsed (Inspector Brad #541)", () => {
  const { adapter, db } = sqliteAdapter();
  adapter.saveTrainingLogEntry("u1", finished("in", 20));
  // A row a month earlier whose payload would throw if it were parsed.
  db.prepare(
    "INSERT INTO training_log (id, user_id, started_at, payload, updated_at) VALUES (?, ?, ?, ?, ?)",
  ).run("old", "u1", "2026-09-01T07:00:00.000Z", "{not json", "x");
  expect(
    adapter
      .getTrainingLog("u1", {
        from: "2026-10-14T00:00:00.000Z",
        to: "2026-10-31T00:00:00.000Z",
      })
      .map((s) => s.id),
  ).toEqual(["in"]);
  // An unbounded read still reaches it.
  expect(() => adapter.getTrainingLog("u1")).toThrow();
});

it("keeps a start just inside the window when stored with an offset", () => {
  const { adapter, db } = sqliteAdapter();
  const offset = {
    ...finished("tz", 20),
    startedAt: "2026-10-20T23:30:00-05:00",
  };
  db.prepare(
    "INSERT INTO training_log (id, user_id, started_at, payload, updated_at) VALUES (?, ?, ?, ?, ?)",
  ).run("tz", "u1", offset.startedAt, JSON.stringify(offset), "x");
  // 04:30Z on the 21st, inside a window that starts at 00:00Z on the 21st.
  expect(
    adapter
      .getTrainingLog("u1", { from: "2026-10-21T00:00:00.000Z" })
      .map((s) => s.id),
  ).toEqual(["tz"]);
});
