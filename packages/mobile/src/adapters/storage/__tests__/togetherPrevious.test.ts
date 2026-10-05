/** @jest-environment node */
import { DatabaseSync } from "node:sqlite";
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
