/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

vi.mock("@persistence/db/client", () => ({
  getDb: vi.fn(),
}));

import { getDb } from "@persistence/db/client";

/**
 * Mocked-DB suites in this repo have shipped runtime-only SQL bugs before
 * (reference_drizzle_groupby_param_bug), so these tests render the actual
 * predicates through `PgDialect` rather than asserting "a where clause ran".
 * The hazard here is the operand SHAPE: `activity_date` / `sleep_date` are
 * Postgres DATE columns (the Drizzle mirror's `text(...)` is stale — see
 * `dataRetentionRepository.ts`) while `created_at` is a timestamptz, so a
 * copy-paste between them would hand Postgres the wrong granularity to cast.
 *
 * ⚠ Known limit of these assertions: the rendered SQL is identical whether the
 * column is declared `text` or `date`, so PgDialect cannot discriminate. These
 * tests pin the PARAMS, which is the part that would actually differ.
 */
interface Capture {
  wheres: unknown[];
  tables: unknown[];
}
function executor(queue: unknown[], capture: Capture) {
  let i = 0;
  const builder: any = {};
  builder.delete = vi.fn((t: unknown) => {
    capture.tables.push(t);
    return builder;
  });
  builder.returning = vi.fn(() => builder);
  builder.where = vi.fn((cond: unknown) => {
    capture.wheres.push(cond);
    return builder;
  });
  builder.then = (
    resolve: (v: unknown[]) => unknown,
    reject: (e: unknown) => unknown,
  ) => {
    const next = queue[i++] ?? [];
    if (next instanceof Error) return reject(next);
    return resolve(next as unknown[]);
  };
  return builder;
}

describe("DataRetentionRepository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deletes from all three tables and returns the row counts", async () => {
    const capture: Capture = { wheres: [], tables: [] };
    const ex = executor(
      [
        [{ id: "a1" }, { id: "a2" }], // daily_activity_data
        [{ id: "s1" }], // sleep_data
        [{ id: "l1" }, { id: "l2" }, { id: "l3" }], // client_data_access_log
      ],
      capture,
    );
    (getDb as any).mockReturnValue(ex);

    const { DataRetentionRepository } =
      await import("../dataRetentionRepository");
    const counts = await new DataRetentionRepository().pruneOlderThan(
      new Date("2025-08-03T02:00:00.000Z"),
    );

    expect(counts).toEqual({
      dailyActivity: 2,
      sleep: 1,
      clientDataAccessLog: 3,
    });
    expect(ex.delete).toHaveBeenCalledTimes(3);
  });

  it("compares the TEXT date columns against a bare ISO date, not a timestamp", async () => {
    const capture: Capture = { wheres: [], tables: [] };
    const ex = executor([[], [], []], capture);
    (getDb as any).mockReturnValue(ex);

    const { DataRetentionRepository } =
      await import("../dataRetentionRepository");
    await new DataRetentionRepository().pruneOlderThan(
      new Date("2025-08-03T02:00:00.000Z"),
    );

    const dialect = new PgDialect();
    const rendered = capture.wheres.map((c) => dialect.sqlToQuery(c as never));

    // [0] daily_activity_data, [1] sleep_data — DATE columns, so the bound param
    // must be a bare "2025-08-03" for Postgres to cast to `date`. A full ISO
    // timestamp is the wrong granularity for the column.
    expect(rendered[0].sql).toContain('"activity_date"');
    expect(rendered[0].params).toEqual(["2025-08-03"]);
    expect(rendered[1].sql).toContain('"sleep_date"');
    expect(rendered[1].params).toEqual(["2025-08-03"]);

    // [2] client_data_access_log — a real timestamptz. Drizzle's column mapper
    // serialises the Date to a full ISO timestamp, so the param keeps the TIME
    // component that the two date columns above deliberately drop.
    expect(rendered[2].sql).toContain('"created_at"');
    expect(rendered[2].params).toEqual(["2025-08-03T02:00:00.000Z"]);
  });

  it("scopes every delete with a strict less-than, never an equality or a range", async () => {
    const capture: Capture = { wheres: [], tables: [] };
    const ex = executor([[], [], []], capture);
    (getDb as any).mockReturnValue(ex);

    const { DataRetentionRepository } =
      await import("../dataRetentionRepository");
    await new DataRetentionRepository().pruneOlderThan(new Date("2025-08-03"));

    const dialect = new PgDialect();
    for (const cond of capture.wheres) {
      const sql = dialect.sqlToQuery(cond as never).sql;
      // A `>` here would delete everything INSIDE the retention window — the
      // exact inversion that turns a retention job into data loss.
      expect(sql).toContain("<");
      expect(sql).not.toContain(">");
    }
    expect(capture.wheres).toHaveLength(3);
  });
});
