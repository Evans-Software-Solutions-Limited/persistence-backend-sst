/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { SessionRepository } from "../../../repositories/sessionRepository";
import { PersonalRecordsRepository } from "../../../repositories/personalRecordsRepository";
let pg: PGlite;
let database: ReturnType<typeof drizzle>;
vi.mock("@persistence/db/client", () => ({ getDb: () => database }));
beforeAll(async () => {
  pg = new PGlite();
  database = drizzle(pg);
  await pg.exec(`
    CREATE TABLE workout_sessions(id text,user_id text,status text,client_session_id text);
    CREATE TABLE together_jobs(user_id text,client_record_id uuid,effects_done boolean);
    CREATE TABLE together_reviewed_results(user_id text,history_id text,effects_version integer,effects_done_version integer);
    INSERT INTO workout_sessions VALUES ('saved','owner','completed','10000000-0000-4000-8000-000000000001'),('unfinished','owner','in_progress',null),('solo','owner','completed','local-existing-solo'),('offline','owner','completed','offline-record');
    INSERT INTO together_jobs VALUES ('owner','10000000-0000-4000-8000-000000000001',false);
    INSERT INTO together_reviewed_results VALUES ('owner','offline',2,1);
  `);
});
afterAll(async () => {
  vi.restoreAllMocks();
  await pg.close();
});
describe("owner-only completed session summary SQL", () => {
  it("rejects foreign, unfinished and pending effects before reading canonical PRs", async () => {
    const replay = vi
      .spyOn(
        PersonalRecordsRepository.prototype,
        "getPersonalRecordsForSessionReplay",
      )
      .mockResolvedValue([]);
    const repo = new SessionRepository();
    const build = vi
      .spyOn(repo as any, "buildRecordedSession")
      .mockResolvedValue({
        id: "saved",
        personalRecords: [],
        workoutsThisMonth: 4,
      });
    expect(await repo.getRecordedSummary("saved", "other")).toBeNull();
    expect(await repo.getRecordedSummary("missing", "owner")).toBeNull();
    expect(await repo.getRecordedSummary("unfinished", "owner")).toBeNull();
    expect(await repo.getRecordedSummary("saved", "owner")).toBeNull();
    expect(await repo.getRecordedSummary("offline", "owner")).toBeNull();
    expect(replay).not.toHaveBeenCalled();
    expect(build).not.toHaveBeenCalled();
    await pg.exec(
      "UPDATE together_jobs SET effects_done=true; UPDATE together_reviewed_results SET effects_done_version=2;",
    );
    expect(await repo.getRecordedSummary("saved", "owner")).toMatchObject({
      workoutsThisMonth: 4,
    });
    expect(replay).toHaveBeenCalledWith("owner", "saved", expect.anything());
    expect(build).toHaveBeenCalledWith(
      expect.anything(),
      "owner",
      "saved",
      [],
      true,
    );
    expect(await repo.getRecordedSummary("offline", "owner")).not.toBeNull();
    expect(await repo.getRecordedSummary("solo", "owner")).not.toBeNull();
    expect(
      (await pg.query("SELECT count(*)::int AS n FROM workout_sessions")).rows,
    ).toEqual([{ n: 4 }]);
  });
});
