/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

vi.mock("@persistence/db/client", () => ({ getDb: vi.fn() }));

import { getDb } from "@persistence/db/client";
import { VolumeRepository } from "../volumeRepository";

// A thenable chain: every builder method returns itself; awaiting resolves the
// supplied result. Covers select().from().innerJoin()...where().groupBy() etc.
function chain(result: unknown) {
  const c: any = {};
  for (const k of [
    "from",
    "innerJoin",
    "leftJoin",
    "where",
    "groupBy",
    "orderBy",
    "limit",
    "offset",
  ]) {
    c[k] = () => c;
  }
  c.then = (res: any, rej: any) => Promise.resolve(result).then(res, rej);
  return c;
}

describe("VolumeRepository", () => {
  beforeEach(() => vi.clearAllMocks());

  it("getUserTimezone returns tz, defaulting to Europe/London", async () => {
    (getDb as any).mockReturnValue({
      select: () => chain([{ tz: "America/Los_Angeles" }]),
    });
    expect(await new VolumeRepository().getUserTimezone("u1")).toBe(
      "America/Los_Angeles",
    );
    (getDb as any).mockReturnValue({ select: () => chain([]) });
    expect(await new VolumeRepository().getUserTimezone("u1")).toBe(
      "Europe/London",
    );
  });

  it("dailyVolume maps grouped rows to {date, volumeKg}", async () => {
    (getDb as any).mockReturnValue({
      select: () =>
        chain([
          { day: "2026-06-08", volume: 600 },
          { day: "2026-06-10T00:00:00.000Z", volume: 900 },
        ]),
    });
    const out = await new VolumeRepository().dailyVolume(
      "u1",
      "Europe/London",
      "2026-06-04",
      "2026-06-10",
    );
    expect(out).toEqual([
      { date: "2026-06-08", volumeKg: 600 },
      { date: "2026-06-10", volumeKg: 900 },
    ]);
  });

  it("dailyVolume groups by the SELECT ordinal, not a re-bound tz expression (Postgres 42803 guard)", async () => {
    // Regression: grouping by a second copy of the `(completed_at AT TIME ZONE
    // <tz>)::date` expression re-binds <tz> in a NEW parameter slot than the
    // SELECT, so Postgres rejects with 42803 ("column ... must appear in the
    // GROUP BY clause"). The fix groups by the select-list ordinal (GROUP BY 1).
    let groupByArg: unknown;
    const capturing = (result: unknown) => {
      const c: any = {};
      for (const k of [
        "from",
        "innerJoin",
        "leftJoin",
        "where",
        "orderBy",
        "limit",
        "offset",
      ]) {
        c[k] = () => c;
      }
      c.groupBy = (arg: unknown) => {
        groupByArg = arg;
        return c;
      };
      c.then = (res: any, rej: any) => Promise.resolve(result).then(res, rej);
      return c;
    };
    (getDb as any).mockReturnValue({ select: () => capturing([]) });
    await new VolumeRepository().dailyVolume(
      "u1",
      "Europe/London",
      "2026-06-04",
      "2026-06-10",
    );
    const { sql: groupSql } = new PgDialect().sqlToQuery(groupByArg as any);
    expect(groupSql.trim()).toBe("1");
    expect(groupSql.toLowerCase()).not.toContain("time zone");
  });

  it("dailyVolume normalises a JS Date day (postgres-js ::date parse)", async () => {
    // The real driver parses `::date` (OID 1082) into a Date, not a string.
    // `String(date).slice(0,10)` would yield "Mon Jun 08" and break the
    // ISO-keyed bar lookup; the repo must toISOString it.
    (getDb as any).mockReturnValue({
      select: () =>
        chain([{ day: new Date("2026-06-08T00:00:00.000Z"), volume: 600 }]),
    });
    const out = await new VolumeRepository().dailyVolume(
      "u1",
      "Europe/London",
      "2026-06-04",
      "2026-06-10",
    );
    expect(out).toEqual([{ date: "2026-06-08", volumeKg: 600 }]);
  });

  it("totalVolume + completedSessionCount coerce to numbers", async () => {
    (getDb as any).mockReturnValue({ select: () => chain([{ v: 1234.5 }]) });
    expect(
      await new VolumeRepository().totalVolume("u1", "UTC", "a", "b"),
    ).toBe(1234.5);

    (getDb as any).mockReturnValue({ select: () => chain([{ c: 3 }]) });
    expect(
      await new VolumeRepository().completedSessionCount("u1", "UTC", "a", "b"),
    ).toBe(3);

    (getDb as any).mockReturnValue({ select: () => chain([]) });
    expect(
      await new VolumeRepository().totalVolume("u1", "UTC", "a", "b"),
    ).toBe(0);
  });

  it("getWeeklyRow returns the materialised row or null", async () => {
    (getDb as any).mockReturnValue({
      select: () => chain([{ volumeKg: "5000", sessionCount: 4 }]),
    });
    expect(
      await new VolumeRepository().getWeeklyRow("u1", "2026-06-08"),
    ).toEqual({ volumeKg: 5000, sessionCount: 4 });
    (getDb as any).mockReturnValue({ select: () => chain([]) });
    expect(
      await new VolumeRepository().getWeeklyRow("u1", "2026-06-08"),
    ).toBeNull();
  });

  it("recomputeWeeklyVolume upserts the week total + session count", async () => {
    const onConflictDoUpdate = vi.fn(() => Promise.resolve(undefined));
    const values = vi.fn(() => ({ onConflictDoUpdate }));
    const insert = vi.fn(() => ({ values }));
    const select = vi
      .fn()
      .mockReturnValueOnce(chain([{ v: 8000 }])) // totalVolume
      .mockReturnValueOnce(chain([{ c: 5 }])); // completedSessionCount
    (getDb as any).mockReturnValue({ select, insert });

    await new VolumeRepository().recomputeWeeklyVolume(
      "u1",
      "Europe/London",
      "2026-06-08",
      "2026-06-14",
    );
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u1",
        weekStart: "2026-06-08",
        volumeKg: "8000",
        sessionCount: 5,
      }),
    );
    expect(onConflictDoUpdate).toHaveBeenCalled();
  });

  it("recomputeVolumeByMuscle aggregates per exercise in SQL then upserts + prunes", async () => {
    const onConflict = vi.fn(() => Promise.resolve(undefined));
    const insertValues = vi.fn(() => ({ onConflictDoUpdate: onConflict }));
    const txInsert = vi.fn(() => ({ values: insertValues }));
    let pruneWhere: any;
    const txDelete = vi.fn(() => ({
      where: (w: any) => {
        pruneWhere = w;
        return Promise.resolve(undefined);
      },
    }));
    const select = vi
      .fn()
      // grouped-by-exercise query: bench (chest+back) 700kg, row (chest) ... no —
      // ex1 hits chest+back at 500, ex2 hits chest at 200.
      .mockReturnValueOnce(
        chain([
          { primaryMuscles: ["m-chest", "m-back"], vol: 500 },
          { primaryMuscles: ["m-chest"], vol: 200 },
        ]),
      )
      // resolveMuscleNames
      .mockReturnValueOnce(
        chain([
          { id: "m-chest", name: "chest", displayName: "Chest" },
          { id: "m-back", name: "back", displayName: null },
        ]),
      );
    const transaction = vi.fn(async (cb: any) =>
      cb({ delete: txDelete, insert: txInsert }),
    );
    (getDb as any).mockReturnValue({ select, transaction });

    await new VolumeRepository().recomputeVolumeByMuscle(
      "u1",
      "Europe/London",
      "month",
      "2026-06-01",
      "2026-06-30",
    );

    const inserted = (insertValues.mock.calls[0] as any[])[0] as any[];
    const chest = inserted.find((r) => r.muscleGroup === "Chest");
    const back = inserted.find((r) => r.muscleGroup === "back");
    expect(chest.volumeKg).toBe(String(500 + 200)); // 700
    expect(back.volumeKg).toBe(String(500));
    expect(chest.windowKind).toBe("month");
    // Race-safe shape: upsert (not plain insert) + prune of absent muscles.
    expect(onConflict).toHaveBeenCalled();
    expect(txDelete).toHaveBeenCalled();
    // Render the prune predicate to real SQL: the keepers MUST expand into one
    // placeholder each (`not in ($n, $m)`) — proving `notInArray`, not a raw
    // `NOT IN ${array}` that binds the whole array as a single param and that
    // Postgres rejects on the hot path (Inspector finding, PR #116).
    const { sql: pruneSql, params } = new PgDialect().sqlToQuery(pruneWhere);
    expect(pruneSql).toMatch(/not in \(\$\d+, \$\d+\)/i);
    expect(params).toEqual(expect.arrayContaining(["Chest", "back"]));
  });

  it("recomputeVolumeByMuscle skips insert (prunes all) when there is no volume", async () => {
    const txInsert = vi.fn();
    const txDelete = vi.fn(() => ({ where: () => Promise.resolve(undefined) }));
    const select = vi
      .fn()
      .mockReturnValueOnce(chain([])) // no exercises
      .mockReturnValueOnce(chain([])); // no muscles
    const transaction = vi.fn(async (cb: any) =>
      cb({ delete: txDelete, insert: txInsert }),
    );
    (getDb as any).mockReturnValue({ select, transaction });

    await new VolumeRepository().recomputeVolumeByMuscle(
      "u1",
      "UTC",
      "month",
      "2026-06-01",
      "2026-06-30",
    );
    expect(txDelete).toHaveBeenCalled();
    expect(txInsert).not.toHaveBeenCalled();
  });

  it("getVolumeByMuscle returns rows sorted by volume desc", async () => {
    (getDb as any).mockReturnValue({
      select: () =>
        chain([
          { muscle: "chest", kg: "7230" },
          { muscle: "legs", kg: "14460" },
        ]),
    });
    expect(
      await new VolumeRepository().getVolumeByMuscle(
        "u1",
        "month",
        "2026-06-01",
      ),
    ).toEqual([
      { muscle: "legs", kg: 14460 },
      { muscle: "chest", kg: 7230 },
    ]);
  });

  it("userIdsWithCompletedSessions maps rows", async () => {
    (getDb as any).mockReturnValue({
      selectDistinct: () => chain([{ userId: "u1" }, { userId: "u2" }]),
    });
    expect(await new VolumeRepository().userIdsWithCompletedSessions()).toEqual(
      ["u1", "u2"],
    );
  });
});
