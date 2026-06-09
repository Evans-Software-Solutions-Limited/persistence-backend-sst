/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@persistence/db/client", () => ({ getDb: vi.fn() }));

import { getDb } from "@persistence/db/client";
import { HabitRepository } from "../habitRepository";

const insertConflict = (val: unknown) => ({
  values: () => ({
    onConflictDoNothing: () => ({ returning: () => Promise.resolve(val) }),
  }),
});
const selectWhereLimit = (val: unknown) => ({
  from: () => ({ where: () => ({ limit: () => Promise.resolve(val) }) }),
});
const selectFromWhereOrderBy = (val: unknown) => ({
  from: () => ({ where: () => ({ orderBy: () => Promise.resolve(val) }) }),
});
const deleteChain = (val: unknown) => ({
  where: () => ({ returning: () => Promise.resolve(val) }),
});

const TS = new Date("2026-06-07T12:00:00Z");

describe("HabitRepository", () => {
  beforeEach(() => vi.clearAllMocks());

  const TZ = [{ tz: "Europe/London" }];

  it("create resolves the user-local date then inserts a new completion", async () => {
    const row = { id: "h1", userId: "u1", goalId: "g1" };
    (getDb as any).mockReturnValue({
      // localDate() tz lookup
      select: () => selectWhereLimit(TZ),
      insert: () => insertConflict([row]),
    });
    const result = await new HabitRepository().create("u1", {
      goalId: "g1",
      completedAt: TS,
      value: 3,
    });
    expect(result).toBe(row);
  });

  it("create returns the existing row on a same-local-day conflict", async () => {
    const existing = { id: "h0", userId: "u1", goalId: "g1" };
    const select = vi
      .fn()
      .mockReturnValueOnce(selectWhereLimit(TZ)) // localDate() tz
      .mockReturnValueOnce(selectWhereLimit([existing])); // conflict fallback
    (getDb as any).mockReturnValue({
      select,
      insert: () => insertConflict([]), // conflict → no row returned
    });
    const result = await new HabitRepository().create("u1", {
      goalId: "g1",
      completedAt: TS,
      value: null,
    });
    expect(result).toBe(existing);
  });

  it("remove reports whether a row was deleted", async () => {
    (getDb as any).mockReturnValue({
      select: () => selectWhereLimit(TZ),
      delete: () => deleteChain([{ id: "h1" }]),
    });
    expect(await new HabitRepository().remove("u1", "g1", TS)).toBe(true);

    (getDb as any).mockReturnValue({
      select: () => selectWhereLimit(TZ),
      delete: () => deleteChain([]),
    });
    expect(await new HabitRepository().remove("u1", "g1", TS)).toBe(false);
  });

  it("list returns rows (default window) and accepts a goal filter", async () => {
    const rows = [{ id: "h1" }];
    (getDb as any).mockReturnValue({
      select: () => selectFromWhereOrderBy(rows),
    });
    expect(await new HabitRepository().list("u1")).toBe(rows);
    expect(
      await new HabitRepository().list("u1", { goalId: "g1", windowDays: 30 }),
    ).toBe(rows);
  });
});
