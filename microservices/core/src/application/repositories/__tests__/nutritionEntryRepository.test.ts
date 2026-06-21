/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@persistence/db/client", () => ({
  getDb: vi.fn(),
}));

import { getDb } from "@persistence/db/client";
import { NutritionEntryRepository } from "../nutritionEntryRepository";

const loggedAt = new Date("2026-06-21T08:30:00.000Z");

// A raw row as Drizzle returns it: numeric columns are STRINGS, loggedAt a Date.
function rawRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "e1",
    userId: "u1",
    foodId: "f1",
    recipeId: null,
    mealId: null,
    mealSlot: "breakfast",
    servings: "2",
    kcal: "300",
    proteinG: "20",
    carbsG: "40",
    fatG: "10",
    loggedAt,
    loggedByUserId: null,
    aiEstimated: false,
    aiConfidence: null,
    ...overrides,
  };
}

function makeListChain(resolved: unknown) {
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        orderBy: vi.fn().mockResolvedValue(resolved),
      }),
    }),
  };
}
function makeUpdateChain(resolved: unknown) {
  return {
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue(resolved),
      }),
    }),
  };
}
function makeDeleteChain(resolved: unknown) {
  return {
    where: vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue(resolved),
    }),
  };
}

describe("NutritionEntryRepository", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("listByDate", () => {
    it("returns parsed DTOs (numeric columns become numbers, loggedAt ISO)", async () => {
      (getDb as any).mockReturnValue({
        select: vi.fn().mockReturnValue(makeListChain([rawRow()])),
      });
      const repo = new NutritionEntryRepository();
      const out = await repo.listByDate("u1", "2026-06-21");

      expect(out).toHaveLength(1);
      const e = out[0];
      expect(e.kcal).toBe(300);
      expect(typeof e.kcal).toBe("number");
      expect(e.servings).toBe(2);
      expect(e.proteinG).toBe(20);
      expect(e.loggedAt).toBe(loggedAt.toISOString());
      expect(e.aiConfidence).toBeNull();
    });

    it("returns [] for an empty day", async () => {
      (getDb as any).mockReturnValue({
        select: vi.fn().mockReturnValue(makeListChain([])),
      });
      const repo = new NutritionEntryRepository();
      expect(await repo.listByDate("u1", "2026-06-21")).toEqual([]);
    });
  });

  describe("create", () => {
    it("inserts and returns the parsed DTO", async () => {
      const valuesSpy = vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([rawRow()]),
      });
      (getDb as any).mockReturnValue({
        insert: vi.fn().mockReturnValue({ values: valuesSpy }),
      });
      const repo = new NutritionEntryRepository();
      const out = await repo.create("u1", {
        foodId: "f1",
        mealSlot: "breakfast",
        servings: 2,
        kcal: 300,
        proteinG: 20,
        carbsG: 40,
        fatG: 10,
        loggedAt: loggedAt.toISOString(),
      });

      expect(out.kcal).toBe(300);
      // numeric columns are stringified for Drizzle insert
      const passed = valuesSpy.mock.calls[0][0];
      expect(passed.kcal).toBe("300");
      expect(passed.servings).toBe("2");
      expect(passed.userId).toBe("u1");
      expect(passed.loggedAt).toBeInstanceOf(Date);
    });
  });

  describe("update", () => {
    it("returns parsed DTO when a row matches", async () => {
      (getDb as any).mockReturnValue({
        update: vi
          .fn()
          .mockReturnValue(makeUpdateChain([rawRow({ servings: "3" })])),
      });
      const repo = new NutritionEntryRepository();
      const out = await repo.update("e1", "u1", { servings: 3 });
      expect(out?.servings).toBe(3);
    });

    it("returns null when no row matches (wrong user / missing)", async () => {
      (getDb as any).mockReturnValue({
        update: vi.fn().mockReturnValue(makeUpdateChain([])),
      });
      const repo = new NutritionEntryRepository();
      expect(await repo.update("e1", "other", { kcal: 1 })).toBeNull();
    });
  });

  describe("delete", () => {
    it("returns true when a row was deleted", async () => {
      (getDb as any).mockReturnValue({
        delete: vi.fn().mockReturnValue(makeDeleteChain([rawRow()])),
      });
      const repo = new NutritionEntryRepository();
      expect(await repo.delete("e1", "u1")).toBe(true);
    });

    it("returns false when nothing matched", async () => {
      (getDb as any).mockReturnValue({
        delete: vi.fn().mockReturnValue(makeDeleteChain([])),
      });
      const repo = new NutritionEntryRepository();
      expect(await repo.delete("e1", "other")).toBe(false);
    });
  });
});
