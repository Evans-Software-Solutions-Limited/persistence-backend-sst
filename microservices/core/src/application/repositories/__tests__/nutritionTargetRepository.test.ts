/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@persistence/db/client", () => ({ getDb: vi.fn() }));
import { getDb } from "@persistence/db/client";
import { NutritionTargetRepository } from "../nutritionTargetRepository";

const updatedAt = new Date("2026-06-21T00:00:00.000Z");

function rawTarget(overrides: Record<string, unknown> = {}) {
  return {
    userId: "u1",
    dailyKcal: "2200",
    proteinG: "170",
    carbsG: "240",
    fatG: "70",
    waterCups: 8,
    preset: "maintain",
    setByUserId: null,
    setByName: null,
    updatedAt,
    ...overrides,
  };
}

function selectChain(resolved: unknown) {
  return {
    from: vi.fn().mockReturnValue({
      leftJoin: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue(resolved),
        }),
      }),
    }),
  };
}

describe("NutritionTargetRepository", () => {
  beforeEach(() => vi.clearAllMocks());

  it("get parses numerics and ISO-stamps updatedAt", async () => {
    (getDb as any).mockReturnValue({
      select: vi.fn().mockReturnValue(selectChain([rawTarget()])),
    });
    const out = await new NutritionTargetRepository().get("u1");
    expect(out?.dailyKcal).toBe(2200);
    expect(typeof out?.dailyKcal).toBe("number");
    expect(out?.waterCups).toBe(8);
    expect(out?.setByName).toBeNull();
    expect(out?.updatedAt).toBe(updatedAt.toISOString());
  });

  it("get exposes setByName only when set_by_user_id is non-null", async () => {
    (getDb as any).mockReturnValue({
      select: vi
        .fn()
        .mockReturnValue(
          selectChain([
            rawTarget({ setByUserId: "coach1", setByName: "Coach Bradley" }),
          ]),
        ),
    });
    const out = await new NutritionTargetRepository().get("u1");
    expect(out?.setByName).toBe("Coach Bradley");
  });

  it("get returns null when no target", async () => {
    (getDb as any).mockReturnValue({
      select: vi.fn().mockReturnValue(selectChain([])),
    });
    expect(await new NutritionTargetRepository().get("u1")).toBeNull();
  });

  it("upsert writes stringified numerics and re-reads via get", async () => {
    const valuesSpy = vi.fn().mockReturnValue({
      onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
    });
    (getDb as any).mockReturnValue({
      insert: vi.fn().mockReturnValue({ values: valuesSpy }),
      select: vi.fn().mockReturnValue(selectChain([rawTarget()])),
    });
    const out = await new NutritionTargetRepository().upsert("u1", {
      dailyKcal: 2200,
      proteinG: 170,
      carbsG: 240,
      fatG: 70,
      waterCups: 8,
      preset: "maintain",
    });
    expect(out.dailyKcal).toBe(2200);
    expect(valuesSpy.mock.calls[0][0].dailyKcal).toBe("2200");
    expect(valuesSpy.mock.calls[0][0].userId).toBe("u1");
  });
});
