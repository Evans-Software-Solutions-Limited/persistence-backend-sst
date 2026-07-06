/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@persistence/db/client", () => ({ getDb: vi.fn() }));

import { getDb } from "@persistence/db/client";
import { HabitHolidayRepository } from "../habitHolidayRepository";

// A fixed "now": 2026-06-10 (a Wednesday), Europe/London.
const NOW = new Date("2026-06-10T09:00:00.000Z");

const tzSelect = (tz = "Europe/London") => ({
  from: () => ({ where: () => ({ limit: () => Promise.resolve([{ tz }]) }) }),
});
const listSelect = (rows: unknown[]) => ({
  from: () => ({ where: () => ({ orderBy: () => Promise.resolve(rows) }) }),
});
const rowSelect = (rows: unknown[]) => ({
  from: () => ({ where: () => ({ limit: () => Promise.resolve(rows) }) }),
});
const insertReturning = (row: unknown) => ({
  values: () => ({ returning: () => Promise.resolve([row]) }),
});
const updateReturning = (row: unknown) => ({
  set: () => ({ where: () => ({ returning: () => Promise.resolve([row]) }) }),
});
const deleteWhere = () => ({ where: () => Promise.resolve(undefined) });

beforeEach(() => vi.clearAllMocks());

describe("HabitHolidayRepository.declare (T-18.2.4 / AC 8.3)", () => {
  it("rejects a start < 24h ahead (today or earlier) with 422", async () => {
    (getDb as any).mockReturnValue({ select: () => tzSelect() });
    // today-local is 2026-06-10; earliest legal start is 2026-06-11.
    const r = await new HabitHolidayRepository().declare(
      "u1",
      "2026-06-10",
      "2026-06-12",
      { now: NOW },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(422);
  });

  it("rejects an inverted range with 422", async () => {
    (getDb as any).mockReturnValue({ select: () => tzSelect() });
    const r = await new HabitHolidayRepository().declare(
      "u1",
      "2026-06-15",
      "2026-06-12",
      { now: NOW },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(422);
  });

  it("inserts a valid ≥24h-ahead holiday (goal_id NULL = all habits)", async () => {
    const row = {
      id: "h1",
      userId: "u1",
      goalId: null,
      startDate: "2026-06-12",
      endDate: "2026-06-14",
    };
    (getDb as any).mockReturnValue({
      select: () => tzSelect(),
      insert: () => insertReturning(row),
    });
    const r = await new HabitHolidayRepository().declare(
      "u1",
      "2026-06-12",
      "2026-06-14",
      { now: NOW },
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.holiday).toEqual(row);
  });
});

describe("HabitHolidayRepository.endEarly (T-18.2.4 / AC 8.3)", () => {
  it("404s when the holiday isn't the user's", async () => {
    (getDb as any).mockReturnValue({ select: () => rowSelect([]) });
    const r = await new HabitHolidayRepository().endEarly("u1", "missing", {
      now: NOW,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(404);
  });

  it("409s on a wholly-past holiday (immutable)", async () => {
    const past = {
      id: "h1",
      userId: "u1",
      startDate: "2026-06-01",
      endDate: "2026-06-05",
    };
    let call = 0;
    (getDb as any).mockReturnValue({
      select: () => (call++ === 0 ? rowSelect([past]) : tzSelect()),
    });
    const r = await new HabitHolidayRepository().endEarly("u1", "h1", {
      now: NOW,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(409);
  });

  it("cancels (deletes) a not-yet-started holiday", async () => {
    const future = {
      id: "h1",
      userId: "u1",
      startDate: "2026-06-20",
      endDate: "2026-06-25",
    };
    let call = 0;
    (getDb as any).mockReturnValue({
      select: () => (call++ === 0 ? rowSelect([future]) : tzSelect()),
      delete: () => deleteWhere(),
    });
    const r = await new HabitHolidayRepository().endEarly("u1", "h1", {
      now: NOW,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.action).toBe("cancelled");
      expect(r.holiday).toBeNull();
    }
  });

  it("truncates an active holiday to today", async () => {
    const active = {
      id: "h1",
      userId: "u1",
      startDate: "2026-06-08",
      endDate: "2026-06-20",
    };
    const truncated = { ...active, endDate: "2026-06-10" };
    let call = 0;
    (getDb as any).mockReturnValue({
      select: () => (call++ === 0 ? rowSelect([active]) : tzSelect()),
      update: () => updateReturning(truncated),
    });
    const r = await new HabitHolidayRepository().endEarly("u1", "h1", {
      now: NOW,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.action).toBe("truncated");
      expect(r.holiday?.endDate).toBe("2026-06-10");
    }
  });
});

describe("HabitHolidayRepository.listForUser", () => {
  it("returns the user's holidays", async () => {
    const rows = [{ id: "h1" }, { id: "h2" }];
    (getDb as any).mockReturnValue({ select: () => listSelect(rows) });
    expect(await new HabitHolidayRepository().listForUser("u1")).toBe(rows);
  });
});
