/** @jest-environment node */
import { DatabaseSync } from "node:sqlite";
import { InMemoryStorageAdapter } from "./in-memory-storage.adapter";
import { SQLiteStorageAdapter } from "../sqlite.adapter";
it("shares only the owner's requested history strictly before session start across timestamp formats", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(
    "CREATE TABLE recent_sets(user_id TEXT,exercise_id TEXT,set_number INTEGER,weight_kg REAL,reps INTEGER,recorded_at TEXT)",
  );
  const insert = db.prepare("INSERT INTO recent_sets VALUES(?,?,?,?,?,?)");
  for (const row of [
    ["u", "ex", 1, 40, 8, "2026-10-05 08:59:59"],
    ["other", "ex", 2, 900, 8, "2026-10-04T00:00:00Z"],
    ["u", "other-ex", 3, 800, 8, "2026-10-04T00:00:00Z"],
    ["u", "ex", 4, 700, 8, "2026-10-05T10:00:00+01:00"],
    ["u", "ex", 5, 600, 8, "2026-10-05T09:00:01Z"],
  ])
    insert.run(...row);
  const adapter = new SQLiteStorageAdapter();
  Object.assign(adapter, {
    db: {
      getAllSync: (sql: string, params: unknown[]) =>
        db.prepare(sql).all(...(params as (string | number)[])),
    },
  });
  expect(
    adapter.getPreviousForTogether("u", ["ex"], "2026-10-05T09:00:00.000Z"),
  ).toEqual([
    {
      exerciseId: "ex",
      setNumber: 1,
      weightKg: 40,
      reps: 8,
      recordedAt: "2026-10-05 08:59:59",
    },
  ]);
  expect(
    adapter.getPreviousForTogether("u", [], "2026-10-05T09:00:00Z"),
  ).toEqual([]);
  expect(adapter.getPreviousForTogether("u", ["ex"], "invalid")).toEqual([]);
  expect(
    adapter.getPreviousForTogether(
      "u",
      Array(101).fill("ex"),
      "2026-10-05T09:00:00Z",
    ),
  ).toEqual([]);
  db.close();
});

it("returns all 105 owner-scoped PREV rows through the last exercise in SQL and memory", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(
    "CREATE TABLE recent_sets(user_id TEXT,exercise_id TEXT,set_number INTEGER,weight_kg REAL,reps INTEGER,recorded_at TEXT)",
  );
  const insert = db.prepare("INSERT INTO recent_sets VALUES(?,?,?,?,?,?)");
  const sql = new SQLiteStorageAdapter();
  Object.assign(sql, {
    db: {
      getAllSync: (query: string, params: (string | number)[]) =>
        db.prepare(query).all(...params),
    },
  });
  const memory = new InMemoryStorageAdapter();
  const exercises = Array.from(
    { length: 15 },
    (_, i) => `exercise-${String(i).padStart(2, "0")}`,
  );
  const rows = exercises.flatMap((exerciseId) =>
    Array.from({ length: 7 }, (_, i) => ({
      exerciseId,
      setNumber: i + 1,
      weightKg: 60,
      reps: 8,
      recordedAt: "2026-10-04T09:00:00Z",
    })),
  );
  for (const owner of ["u", "other"]) {
    const ownRows = rows.map((row) => ({
      ...row,
      weightKg: owner === "u" ? 60 : 999,
    }));
    memory.upsertRecentSets(owner, ownRows);
    for (const row of ownRows)
      insert.run(
        owner,
        row.exerciseId,
        row.setNumber,
        row.weightKg,
        row.reps,
        row.recordedAt,
      );
  }
  for (const row of [
    { ...rows[0], exerciseId: "outside" },
    { ...rows[0], setNumber: 8, recordedAt: "2026-10-05T09:00:00Z" },
  ]) {
    memory.upsertRecentSets("u", [row]);
    insert.run(
      "u",
      row.exerciseId,
      row.setNumber,
      row.weightKg,
      row.reps,
      row.recordedAt,
    );
  }
  for (const storage of [sql, memory]) {
    const actual = storage.getPreviousForTogether(
      "u",
      exercises,
      "2026-10-05T09:00:00Z",
    );
    expect(actual).toEqual(rows);
    expect(actual.at(-1)).toEqual({
      ...rows[0],
      exerciseId: "exercise-14",
      setNumber: 7,
    });
  }
  db.close();
});
