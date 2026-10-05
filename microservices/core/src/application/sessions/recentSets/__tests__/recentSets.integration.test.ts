import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@persistence/db/client", () => ({ getDb: () => holder.db }));
import { SessionRepository } from "../../../repositories/sessionRepository";
let pg: PGlite;
beforeAll(async () => {
  pg = await PGlite.create();
  holder.db = drizzle(pg);
  await pg.exec(`
    CREATE TABLE workout_sessions(id text primary key,user_id text,status text,completed_at timestamptz,started_at timestamptz);
    CREATE TABLE session_exercises(id text primary key,session_id text,exercise_id text,is_substituted boolean);
    CREATE TABLE exercise_sets(session_exercise_id text,set_number integer,weight_kg numeric,reps integer);
    INSERT INTO workout_sessions VALUES
      ('old','owner','completed','2026-10-01Z','2026-10-01Z'),
      ('latest','owner','completed','2026-10-06Z','2026-10-06Z'),
      ('other','other','completed','2026-10-04Z','2026-10-04Z'),
      ('unfinished','owner','in_progress',null,'2026-10-04Z');
    INSERT INTO session_exercises VALUES
      ('old-squat','old','squat',false),('old-press','old','press',false),
      ('new-squat','latest','squat',false),('other-squat','other','squat',false),
      ('unfinished-squat','unfinished','squat',false);
    INSERT INTO exercise_sets VALUES
      ('old-squat',1,60,8),('old-press',1,40,8),('new-squat',1,90,8),('other-squat',1,200,8),('unfinished-squat',1,300,8);
  `);
});
afterAll(async () => pg?.close());
it("selects the latest own set inside the requested original-start window, before DISTINCT ON", async () => {
  const repo = new SessionRepository();
  const scoped = await repo.getRecentSets("owner", {
    exerciseIds: ["squat"],
    before: new Date("2026-10-05T00:00:00Z"),
  });
  expect(scoped).toEqual([
    {
      exerciseId: "squat",
      setNumber: 1,
      weightKg: "60",
      reps: 8,
      recordedAt: new Date("2026-10-01T00:00:00Z"),
    },
  ]);
  const latest = await repo.getRecentSets("owner");
  expect(latest).toHaveLength(2);
  expect(latest.find((r) => r.exerciseId === "squat")?.weightKg).toBe("90");
  expect(
    await repo.getRecentSets("unknown", {
      exerciseIds: ["squat"],
      before: new Date("2026-10-05T00:00:00Z"),
    }),
  ).toEqual([]);
  expect(
    await repo.getRecentSets("owner", {
      exerciseIds: ["squat"],
      before: new Date("2026-10-01T00:00:00Z"),
    }),
  ).toEqual([]);
});
