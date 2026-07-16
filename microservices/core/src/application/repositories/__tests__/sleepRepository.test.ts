/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

vi.mock("@persistence/db/client", () => ({ getDb: vi.fn() }));

import { getDb } from "@persistence/db/client";
import { SleepRepository } from "../sleepRepository";

function makeSelectChain(
  resolvedValue: unknown,
  captureWhere?: (w: unknown) => void,
) {
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockImplementation((w: unknown) => {
        captureWhere?.(w);
        return {
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue(resolvedValue),
          }),
        };
      }),
    }),
  };
}

describe("SleepRepository", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("upsertManual", () => {
    it("writes data_source='manual' + returns the stored row", async () => {
      const valuesSpy = vi.fn();
      const storedRow = {
        id: "s1",
        userId: "u1",
        sleepDate: "2026-07-16",
        durationMinutes: 450,
        dataSource: "manual",
      };
      const onConflictSpy = vi
        .fn()
        .mockReturnValue({ returning: vi.fn().mockResolvedValue([storedRow]) });
      (getDb as any).mockReturnValue({
        insert: vi.fn().mockReturnValue({
          values: valuesSpy.mockReturnValue({
            onConflictDoUpdate: onConflictSpy,
          }),
        }),
      });

      const row = await new SleepRepository().upsertManual("u1", {
        sleepDate: "2026-07-16",
        durationMinutes: 450,
      });

      expect(valuesSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "u1",
          sleepDate: "2026-07-16",
          durationMinutes: 450,
          dataSource: "manual",
          sleepStart: null,
          sleepEnd: null,
        }),
      );
      expect(row).toEqual(storedRow);
    });

    it("re-saving the same day targets the unique (user_id, sleep_date, data_source) index — one row per day, not a duplicate insert (AC 1.4)", async () => {
      const onConflictSpy = vi
        .fn()
        .mockReturnValue({ returning: vi.fn().mockResolvedValue([{}]) });
      (getDb as any).mockReturnValue({
        insert: vi.fn().mockReturnValue({
          values: vi
            .fn()
            .mockReturnValue({ onConflictDoUpdate: onConflictSpy }),
        }),
      });

      await new SleepRepository().upsertManual("u1", {
        sleepDate: "2026-07-16",
        durationMinutes: 400,
      });

      expect(onConflictSpy).toHaveBeenCalledTimes(1);
      const arg = onConflictSpy.mock.calls[0][0];
      // Column identity, not just name — proves the conflict target really is
      // the `sleep_data_user_date_source_idx` unique index (user_id,
      // sleep_date, data_source), so a same-day re-save updates in place.
      expect(arg.target.map((c: any) => c.name)).toEqual([
        "user_id",
        "sleep_date",
        "data_source",
      ]);
      expect(arg.set).toMatchObject({ durationMinutes: 400 });
    });

    it("PgDialect render guard: the conflict SET bumps created_at to now() (mocked-DB blind-spot guard — a dropped bump would silently break the D3 'most-recent wins' pill precedence)", async () => {
      const onConflictSpy = vi
        .fn()
        .mockReturnValue({ returning: vi.fn().mockResolvedValue([{}]) });
      (getDb as any).mockReturnValue({
        insert: vi.fn().mockReturnValue({
          values: vi
            .fn()
            .mockReturnValue({ onConflictDoUpdate: onConflictSpy }),
        }),
      });

      await new SleepRepository().upsertManual("u1", {
        sleepDate: "2026-07-16",
        durationMinutes: 400,
      });

      const arg = onConflictSpy.mock.calls[0][0];
      const { sql: renderedSql, params } = new PgDialect().sqlToQuery(
        arg.set.createdAt,
      );
      expect(renderedSql.trim().toLowerCase()).toBe("now()");
      expect(params).toEqual([]);
    });

    it("passes through optional sleepStart/sleepEnd", async () => {
      const valuesSpy = vi.fn();
      const onConflictSpy = vi
        .fn()
        .mockReturnValue({ returning: vi.fn().mockResolvedValue([{}]) });
      (getDb as any).mockReturnValue({
        insert: vi.fn().mockReturnValue({
          values: valuesSpy.mockReturnValue({
            onConflictDoUpdate: onConflictSpy,
          }),
        }),
      });

      const sleepStart = new Date("2026-07-15T23:30:00.000Z");
      const sleepEnd = new Date("2026-07-16T07:00:00.000Z");
      await new SleepRepository().upsertManual("u1", {
        sleepDate: "2026-07-16",
        durationMinutes: 450,
        sleepStart,
        sleepEnd,
      });

      expect(valuesSpy).toHaveBeenCalledWith(
        expect.objectContaining({ sleepStart, sleepEnd }),
      );
      expect(onConflictSpy.mock.calls[0][0].set).toMatchObject({
        sleepStart,
        sleepEnd,
      });
    });
  });

  describe("getForDate — data isolation (DANGEROUS AREA)", () => {
    it("scopes the WHERE clause to the caller's userId — never another user's row for the same date", async () => {
      let capturedWhere: unknown;
      (getDb as any).mockReturnValue({
        select: vi.fn().mockReturnValue(
          makeSelectChain(
            [
              {
                userId: "userA",
                sleepDate: "2026-07-16",
                durationMinutes: 420,
              },
            ],
            (w) => (capturedWhere = w),
          ),
        ),
      });

      const rowA = await new SleepRepository().getForDate(
        "userA",
        "2026-07-16",
      );
      expect(rowA).toEqual({
        userId: "userA",
        sleepDate: "2026-07-16",
        durationMinutes: 420,
      });

      const { sql: renderedSql, params } = new PgDialect().sqlToQuery(
        capturedWhere as any,
      );
      expect(renderedSql).toContain("user_id");
      expect(renderedSql).toContain("sleep_date");
      expect(params).toContain("userA");
      expect(params).not.toContain("userB");
    });

    it("returns null for a user with no row, even when another user logged the same date", async () => {
      (getDb as any).mockReturnValue({
        select: vi.fn().mockReturnValue(makeSelectChain([])),
      });

      const rowB = await new SleepRepository().getForDate(
        "userB",
        "2026-07-16",
      );
      expect(rowB).toBeNull();
    });

    it("orders by created_at desc + limits 1 (most-recent-wins, Decision D3)", async () => {
      let capturedOrderBy: unknown;
      (getDb as any).mockReturnValue({
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockImplementation((o: unknown) => {
                capturedOrderBy = o;
                return { limit: vi.fn().mockResolvedValue([]) };
              }),
            }),
          }),
        }),
      });

      await new SleepRepository().getForDate("u1", "2026-07-16");

      const { sql: renderedSql } = new PgDialect().sqlToQuery(
        capturedOrderBy as any,
      );
      expect(renderedSql.toLowerCase()).toContain("created_at");
      expect(renderedSql.toLowerCase()).toContain("desc");
    });
  });
});
