/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@persistence/db/client", () => ({ getDb: vi.fn() }));
import { getDb } from "@persistence/db/client";
import { MealRepository } from "../mealRepository";

const mealRow = {
  id: "m1",
  userId: "u1",
  name: "Usual lunch",
  photoUrl: null,
  totalKcal: "650",
  totalProteinG: "40",
  totalCarbsG: "70",
  totalFatG: "20",
  createdAt: new Date(),
};
const itemRow = {
  id: "mi1",
  mealId: "m1",
  foodId: "f1",
  recipeId: null,
  servings: "2",
  sortOrder: 0,
};

const mealLookup = (rows: unknown) => ({
  from: () => ({ where: () => ({ limit: () => Promise.resolve(rows) }) }),
});
const itemLookup = (rows: unknown) => ({
  from: () => ({ where: () => Promise.resolve(rows) }),
});

describe("MealRepository", () => {
  beforeEach(() => vi.clearAllMocks());

  it("getById returns null when missing / not owned", async () => {
    (getDb as any).mockReturnValue({
      select: vi.fn().mockReturnValueOnce(mealLookup([])),
    });
    expect(await new MealRepository().getById("m1", "u1")).toBeNull();
  });

  it("getById returns the meal with parsed totals + sorted items", async () => {
    (getDb as any).mockReturnValue({
      select: vi
        .fn()
        .mockReturnValueOnce(mealLookup([mealRow]))
        .mockReturnValueOnce(
          itemLookup([
            { ...itemRow, id: "mi2", sortOrder: 1 },
            { ...itemRow, sortOrder: 0 },
          ]),
        ),
    });
    const out = await new MealRepository().getById("m1", "u1");
    expect(out?.totalKcal).toBe(650);
    expect(out?.items.map((i) => i.id)).toEqual(["mi1", "mi2"]);
    expect(out?.items[0].servings).toBe(2);
  });

  it("list maps rows without items", async () => {
    (getDb as any).mockReturnValue({
      select: vi.fn().mockReturnValue({
        from: () => ({
          where: () => ({ orderBy: () => Promise.resolve([mealRow]) }),
        }),
      }),
    });
    const out = await new MealRepository().list("u1");
    expect(out[0].items).toEqual([]);
    expect(out[0].totalProteinG).toBe(40);
  });

  it("create inserts meal + items in a tx and returns the hydrated meal", async () => {
    const itemValuesSpy = vi.fn().mockResolvedValue(undefined);
    const tx = {
      insert: vi
        .fn()
        .mockReturnValueOnce({
          values: () => ({ returning: () => Promise.resolve([{ id: "m1" }]) }),
        })
        .mockReturnValueOnce({ values: itemValuesSpy }),
    };
    (getDb as any).mockReturnValue({
      transaction: (cb: any) => cb(tx),
      select: vi
        .fn()
        .mockReturnValueOnce(mealLookup([mealRow]))
        .mockReturnValueOnce(itemLookup([itemRow])),
    });
    const out = await new MealRepository().create(
      "u1",
      {
        name: "Usual lunch",
        items: [{ foodId: "f1", servings: 2, sortOrder: 0 }],
      },
      { kcal: 650, proteinG: 40, carbsG: 70, fatG: 20 },
    );
    expect(out.id).toBe("m1");
    expect(itemValuesSpy).toHaveBeenCalled();
  });

  it("update returns null when not owned", async () => {
    (getDb as any).mockReturnValue({
      update: () => ({
        set: () => ({
          where: () => ({ returning: () => Promise.resolve([]) }),
        }),
      }),
    });
    expect(
      await new MealRepository().update("m1", "other", { name: "x" }),
    ).toBeNull();
  });

  it("delete returns true on a row match", async () => {
    (getDb as any).mockReturnValue({
      delete: () => ({
        where: () => ({ returning: () => Promise.resolve([mealRow]) }),
      }),
    });
    expect(await new MealRepository().delete("m1", "u1")).toBe(true);
  });
});
