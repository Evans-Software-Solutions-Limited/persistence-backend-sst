/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

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

  it("recomputeVolumeByMuscle aggregates per muscle and replaces the window", async () => {
    const insertValues = vi.fn(() => Promise.resolve(undefined));
    const txInsert = vi.fn(() => ({ values: insertValues }));
    const txDelete = vi.fn(() => ({ where: () => Promise.resolve(undefined) }));
    const select = vi
      .fn()
      // join query: two sets; first hits chest+back, second hits chest
      .mockReturnValueOnce(
        chain([
          { weightKg: "50", reps: 10, primaryMuscles: ["m-chest", "m-back"] },
          { weightKg: "40", reps: 5, primaryMuscles: ["m-chest"] },
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
    );

    expect(txDelete).toHaveBeenCalled();
    const inserted = (insertValues.mock.calls[0] as any[])[0] as any[];
    const chest = inserted.find((r) => r.muscleGroup === "Chest");
    const back = inserted.find((r) => r.muscleGroup === "back");
    expect(chest.volumeKg).toBe(String(50 * 10 + 40 * 5)); // 700
    expect(back.volumeKg).toBe(String(50 * 10)); // 500
    expect(chest.windowKind).toBe("month");
  });

  it("recomputeVolumeByMuscle skips insert when there is no volume", async () => {
    const txInsert = vi.fn();
    const txDelete = vi.fn(() => ({ where: () => Promise.resolve(undefined) }));
    const select = vi
      .fn()
      .mockReturnValueOnce(chain([])) // no sets
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
