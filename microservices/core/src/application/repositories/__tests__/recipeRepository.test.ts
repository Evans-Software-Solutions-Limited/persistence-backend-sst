/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@persistence/db/client", () => ({ getDb: vi.fn() }));
import { getDb } from "@persistence/db/client";
import { RecipeRepository } from "../recipeRepository";

const recipeRow = {
  id: "r1",
  userId: "u1",
  name: "Bowl",
  photoUrl: null,
  servings: "2",
  instructions: "mix",
  source: "manual",
  sourceUrl: null,
  totalKcal: "300",
  totalProteinG: "20",
  totalCarbsG: "40",
  totalFatG: "10",
  createdAt: new Date(),
};
const ingRow = {
  id: "i1",
  recipeId: "r1",
  foodId: "f1",
  customName: null,
  quantity: "100",
  unit: "g",
  sortOrder: 0,
};

// recipe lookup: select().from().where().limit() -> rows
const recipeLookup = (rows: unknown) => ({
  from: () => ({ where: () => ({ limit: () => Promise.resolve(rows) }) }),
});
// ingredients lookup: select().from().where() -> rows (awaited)
const ingLookup = (rows: unknown) => ({
  from: () => ({ where: () => Promise.resolve(rows) }),
});

describe("RecipeRepository", () => {
  beforeEach(() => vi.clearAllMocks());

  it("getById returns null when the recipe is missing / not owned", async () => {
    (getDb as any).mockReturnValue({
      select: vi.fn().mockReturnValueOnce(recipeLookup([])),
    });
    expect(await new RecipeRepository().getById("r1", "u1")).toBeNull();
  });

  it("getById returns the recipe with parsed totals + sorted ingredients", async () => {
    (getDb as any).mockReturnValue({
      select: vi
        .fn()
        .mockReturnValueOnce(recipeLookup([recipeRow]))
        .mockReturnValueOnce(
          ingLookup([
            { ...ingRow, sortOrder: 1, id: "i2" },
            { ...ingRow, sortOrder: 0 },
          ]),
        ),
    });
    const out = await new RecipeRepository().getById("r1", "u1");
    expect(out?.totalKcal).toBe(300);
    expect(out?.servings).toBe(2);
    expect(out?.ingredients.map((i) => i.id)).toEqual(["i1", "i2"]);
    expect(out?.ingredients[0].quantity).toBe(100);
  });

  it("list maps rows without ingredients", async () => {
    (getDb as any).mockReturnValue({
      select: vi.fn().mockReturnValue({
        from: () => ({
          where: () => ({ orderBy: () => Promise.resolve([recipeRow]) }),
        }),
      }),
    });
    const out = await new RecipeRepository().list("u1");
    expect(out).toHaveLength(1);
    expect(out[0].ingredients).toEqual([]);
  });

  it("create inserts recipe + ingredients in a tx and returns the hydrated recipe", async () => {
    const ingValuesSpy = vi.fn().mockResolvedValue(undefined);
    const tx = {
      insert: vi
        .fn()
        .mockReturnValueOnce({
          values: () => ({ returning: () => Promise.resolve([{ id: "r1" }]) }),
        })
        .mockReturnValueOnce({ values: ingValuesSpy }),
    };
    (getDb as any).mockReturnValue({
      transaction: (cb: any) => cb(tx),
      select: vi
        .fn()
        .mockReturnValueOnce(recipeLookup([recipeRow]))
        .mockReturnValueOnce(ingLookup([ingRow])),
    });

    const out = await new RecipeRepository().create(
      "u1",
      {
        name: "Bowl",
        servings: 2,
        ingredients: [{ foodId: "f1", quantity: 100, unit: "g", sortOrder: 0 }],
      },
      { kcal: 300, proteinG: 20, carbsG: 40, fatG: 10 },
    );
    expect(out.id).toBe("r1");
    expect(ingValuesSpy).toHaveBeenCalled();
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
      await new RecipeRepository().update("r1", "other", { name: "x" }),
    ).toBeNull();
  });

  it("delete returns true/false on row match", async () => {
    (getDb as any).mockReturnValue({
      delete: () => ({
        where: () => ({ returning: () => Promise.resolve([recipeRow]) }),
      }),
    });
    expect(await new RecipeRepository().delete("r1", "u1")).toBe(true);
  });
});
