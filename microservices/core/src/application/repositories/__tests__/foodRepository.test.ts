/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@persistence/db/client", () => ({
  getDb: vi.fn(),
}));

import { getDb } from "@persistence/db/client";
import { FoodRepository } from "../foodRepository";

const rawFood = {
  id: "f1",
  name: "Oats",
  brand: "Quaker",
  barcode: "123",
  kcal: "150",
  proteinG: "5",
  carbsG: "27",
  fatG: "3",
  servingSize: "40",
  servingUnit: "g",
  source: "openfoodfacts",
  createdBy: null,
  createdAt: new Date(),
};

function selectLimitChain(resolved: unknown) {
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue(resolved),
      }),
    }),
  };
}
function searchChain(resolved: unknown) {
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        orderBy: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue(resolved),
        }),
      }),
    }),
  };
}

describe("FoodRepository", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("getById", () => {
    it("returns a parsed FoodDTO (numerics as numbers)", async () => {
      (getDb as any).mockReturnValue({
        select: vi.fn().mockReturnValue(selectLimitChain([rawFood])),
      });
      const out = await new FoodRepository().getById("f1");
      expect(out?.kcal).toBe(150);
      expect(typeof out?.kcal).toBe("number");
      expect(out?.servingSize).toBe(40);
    });
    it("returns null when not found", async () => {
      (getDb as any).mockReturnValue({
        select: vi.fn().mockReturnValue(selectLimitChain([])),
      });
      expect(await new FoodRepository().getById("nope")).toBeNull();
    });
  });

  describe("getByBarcode", () => {
    it("returns the matching food", async () => {
      (getDb as any).mockReturnValue({
        select: vi.fn().mockReturnValue(selectLimitChain([rawFood])),
      });
      const out = await new FoodRepository().getByBarcode("123");
      expect(out?.barcode).toBe("123");
    });
    it("returns null on a cache miss", async () => {
      (getDb as any).mockReturnValue({
        select: vi.fn().mockReturnValue(selectLimitChain([])),
      });
      expect(await new FoodRepository().getByBarcode("999")).toBeNull();
    });
  });

  describe("search", () => {
    it("maps rows to DTOs", async () => {
      (getDb as any).mockReturnValue({
        select: vi.fn().mockReturnValue(searchChain([rawFood])),
      });
      const out = await new FoodRepository().search("oat", "u1");
      expect(out).toHaveLength(1);
      expect(out[0].kcal).toBe(150);
    });
  });

  describe("create", () => {
    it("stringifies numerics, stamps createdBy + source, returns the DTO", async () => {
      const valuesSpy = vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([rawFood]),
      });
      (getDb as any).mockReturnValue({
        insert: vi.fn().mockReturnValue({ values: valuesSpy }),
      });
      const out = await new FoodRepository().create("u1", {
        name: "Oats",
        kcal: 150,
        proteinG: 5,
        carbsG: 27,
        fatG: 3,
        servingSize: 40,
        servingUnit: "g",
      });
      expect(out.id).toBe("f1");
      const passed = valuesSpy.mock.calls[0][0];
      expect(passed.kcal).toBe("150");
      expect(passed.createdBy).toBe("u1");
      expect(passed.source).toBe("user");
    });
  });
});
