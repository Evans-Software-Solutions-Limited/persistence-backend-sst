/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@persistence/db/client", () => ({
  getDb: vi.fn(),
}));

import { getDb } from "@persistence/db/client";
import { FoodRepository } from "../foodRepository";

function makeSelectChain(resolved: unknown) {
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue(resolved),
      }),
    }),
  };
}

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

describe("FoodRepository.getById", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns a parsed FoodDTO (numerics as numbers)", async () => {
    (getDb as any).mockReturnValue({
      select: vi.fn().mockReturnValue(makeSelectChain([rawFood])),
    });
    const out = await new FoodRepository().getById("f1");
    expect(out?.kcal).toBe(150);
    expect(typeof out?.kcal).toBe("number");
    expect(out?.servingSize).toBe(40);
    expect(out?.source).toBe("openfoodfacts");
  });

  it("returns null when not found", async () => {
    (getDb as any).mockReturnValue({
      select: vi.fn().mockReturnValue(makeSelectChain([])),
    });
    expect(await new FoodRepository().getById("nope")).toBeNull();
  });
});
