/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

vi.mock("@persistence/db/client", () => ({ getDb: vi.fn() }));

import { getDb } from "@persistence/db/client";
import {
  AI_COSTS,
  MAX_COST_PER_CALL_USD,
  costPerCall,
} from "@persistence/subscription-catalog/ai-costs";
import {
  AI_BUDGET_WINDOW_DAYS,
  budgetAllows,
  hasAiBudget,
  loadAiMonthlyBudgetUsd,
  priceUsage,
  spentInWindowUsd,
} from "../aiBudget";

const PHOTO = costPerCall(AI_COSTS.nutrition_photo.profile);
const RESOLVE = costPerCall(AI_COSTS.resolve_ingredient.profile);

/**
 * Drizzle-shaped stub. Each `select()` consumes one queued row-set; the
 * chain supports the three shapes aiBudget uses:
 *   sub read:   from().leftJoin().where().orderBy().limit()
 *   free read:  from().where().limit()
 *   spend read: from().where().groupBy()
 */
function makeDb(queue: unknown[][]) {
  const calls: { where: unknown[]; groupBy: unknown[] } = {
    where: [],
    groupBy: [],
  };
  const select = vi.fn(() => {
    if (queue.length === 0) throw new Error("test stub exhausted");
    const rows = queue.shift();
    const limit = vi.fn().mockResolvedValue(rows);
    const orderBy = vi.fn().mockReturnValue({ limit });
    const groupBy = vi.fn((arg: unknown) => {
      calls.groupBy.push(arg);
      return Promise.resolve(rows);
    });
    const where = vi.fn((arg: unknown) => {
      calls.where.push(arg);
      return { limit, orderBy, groupBy };
    });
    const leftJoin = vi.fn().mockReturnValue({ where });
    return { from: vi.fn().mockReturnValue({ where, leftJoin }) };
  });
  return { db: { select }, calls };
}

function useDb(queue: unknown[][]) {
  const stub = makeDb(queue);
  vi.mocked(getDb).mockReturnValue(stub.db as any);
  return stub;
}

const FUTURE = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
const PAST = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);

function sub(overrides: Record<string, unknown> = {}) {
  return {
    paymentStatus: "active",
    expiresAt: FUTURE,
    cancelledAt: null,
    metadata: {},
    budget: "7.26",
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(getDb).mockReset();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

describe("budgetAllows", () => {
  it("allows a call that fits the remainder exactly", () => {
    expect(
      budgetAllows({ budgetUsd: 1, spentUsd: 0.7, nextCallUsd: 0.3 }),
    ).toBe(true);
  });

  it("refuses a call that would overshoot", () => {
    expect(
      budgetAllows({ budgetUsd: 1, spentUsd: 0.99, nextCallUsd: 0.02 }),
    ).toBe(false);
  });

  it("lets a cheap call through where an expensive one would not (AC 2.1)", () => {
    const state = { budgetUsd: 1, spentUsd: 1 - PHOTO / 2 };
    expect(budgetAllows({ ...state, nextCallUsd: PHOTO })).toBe(false);
    expect(budgetAllows({ ...state, nextCallUsd: RESOLVE })).toBe(true);
  });
});

describe("priceUsage", () => {
  it("prices each endpoint's calls from the shared table", () => {
    expect(
      priceUsage([
        { endpoint: "/nutrition/ai/estimate", calls: 2 },
        { endpoint: "resolve-ingredient", calls: "10" },
      ]),
    ).toBeCloseTo(2 * PHOTO + 10 * RESOLVE, 10);
  });

  it("prices an unknown endpoint at the most expensive call", () => {
    expect(priceUsage([{ endpoint: "/mystery", calls: 3 }])).toBeCloseTo(
      3 * MAX_COST_PER_CALL_USD,
      10,
    );
  });

  it("is zero for no usage", () => {
    expect(priceUsage([])).toBe(0);
  });
});

describe("loadAiMonthlyBudgetUsd", () => {
  it("reads the live tier's budget", async () => {
    useDb([[sub({ budget: "7.26" })]]);
    expect(await loadAiMonthlyBudgetUsd("u1")).toBe(7.26);
  });

  it("treats a NULL budget as zero — fails closed, never open", async () => {
    useDb([[sub({ budget: null })]]);
    expect(await loadAiMonthlyBudgetUsd("u1")).toBe(0);
  });

  it("treats a negative or garbage budget as zero", async () => {
    useDb([[sub({ budget: "-5" })]]);
    expect(await loadAiMonthlyBudgetUsd("u1")).toBe(0);
    useDb([[sub({ budget: "not-a-number" })]]);
    expect(await loadAiMonthlyBudgetUsd("u1")).toBe(0);
  });

  it("falls back to the free tier when there is no subscription", async () => {
    useDb([[], [{ budget: "0.00" }]]);
    expect(await loadAiMonthlyBudgetUsd("u1")).toBe(0);
  });

  it("falls back to the free tier when the subscription has lapsed", async () => {
    useDb([
      [sub({ paymentStatus: "past_due", expiresAt: PAST })],
      [{ budget: "1.50" }],
    ]);
    expect(await loadAiMonthlyBudgetUsd("u1")).toBe(1.5);
  });

  it("uses a scheduled tier once its change has taken effect", async () => {
    // Upgrade premium → premium_plus whose effective time has passed: the
    // budget follows the new tier, matching the Loadout/Mealprint checks.
    const stub = useDb([
      [
        sub({
          budget: "4.89",
          metadata: {
            scheduled_change: {
              next_tier_name: "premium_plus",
              effective_at: PAST.toISOString(),
            },
          },
        }),
      ],
      [{ budget: "7.26" }],
    ]);
    expect(await loadAiMonthlyBudgetUsd("u1")).toBe(7.26);
    expect(stub.db.select).toHaveBeenCalledTimes(2);
  });

  it("keeps the stored tier while a scheduled change is still in the future", async () => {
    const stub = useDb([
      [
        sub({
          budget: "24.20",
          metadata: {
            scheduled_change: {
              next_tier_name: "individual_trainer",
              effective_at: FUTURE.toISOString(),
            },
          },
        }),
      ],
    ]);
    expect(await loadAiMonthlyBudgetUsd("u1")).toBe(24.2);
    expect(stub.db.select).toHaveBeenCalledTimes(1);
  });

  it("falls back to free when the scheduled tier has no catalog row", async () => {
    useDb([
      [
        sub({
          metadata: {
            scheduled_change: {
              next_tier_name: "retired_tier",
              effective_at: PAST.toISOString(),
            },
          },
        }),
      ],
      [],
      [{ budget: "0.00" }],
    ]);
    expect(await loadAiMonthlyBudgetUsd("u1")).toBe(0);
  });

  it("is zero when even the free tier row is missing", async () => {
    useDb([[], []]);
    expect(await loadAiMonthlyBudgetUsd("u1")).toBe(0);
  });
});

describe("spentInWindowUsd", () => {
  it("prices the grouped usage rows and groups by endpoint", async () => {
    const stub = useDb([
      [
        { endpoint: "/nutrition/ai/estimate", calls: 3 },
        { endpoint: "resolve-ingredient", calls: 4 },
      ],
    ]);
    const spent = await spentInWindowUsd(
      "u1",
      new Date("2026-11-02T12:00:00Z"),
    );
    expect(spent).toBeCloseTo(3 * PHOTO + 4 * RESOLVE, 10);
    expect(stub.calls.groupBy).toHaveLength(1);
    expect(AI_BUDGET_WINDOW_DAYS).toBe(30);
  });
});

describe("hasAiBudget", () => {
  it("allows a call inside the budget", async () => {
    useDb([
      [sub({ budget: "7.26" })],
      [{ endpoint: "/nutrition/ai/estimate", calls: 10 }],
    ]);
    expect(await hasAiBudget("u1", "/nutrition/ai/estimate")).toBe(true);
  });

  it("refuses once the next call would pass the budget", async () => {
    // $1.00 budget, ~64 photo calls already spent ≈ $0.99.
    useDb([
      [sub({ budget: "1.00" })],
      [{ endpoint: "/nutrition/ai/estimate", calls: 64 }],
    ]);
    expect(await hasAiBudget("u1", "/nutrition/ai/estimate")).toBe(false);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("reason=exhausted"),
    );
  });

  it("still allows a cheap call when an expensive one is refused", async () => {
    const usage = [{ endpoint: "/nutrition/ai/estimate", calls: 64 }];
    useDb([[sub({ budget: "1.00" })], usage]);
    expect(await hasAiBudget("u1", "resolve-ingredient")).toBe(true);
  });

  it("refuses without reading usage when no budget is configured", async () => {
    const stub = useDb([[sub({ budget: null })]]);
    expect(await hasAiBudget("u1", "resolve-ingredient")).toBe(false);
    expect(stub.calls.groupBy).toHaveLength(0);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("reason=no_budget"),
    );
  });

  it("propagates database errors so the caller fails closed", async () => {
    vi.mocked(getDb).mockReturnValue({
      select: () => {
        throw new Error("db down");
      },
    } as any);
    await expect(hasAiBudget("u1", "resolve-ingredient")).rejects.toThrow(
      "db down",
    );
  });
});

/**
 * Guard: every endpoint string an AI handler writes to `ai_usage_log` must be
 * in the shared cost table, or its calls would be priced at the maximum and
 * the budget would bind far too early. Scans the handler sources for the
 * `ENDPOINT = "..."` / `endpoint: "..."` literals.
 */
describe("cost table coverage", () => {
  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) {
        if (name !== "__tests__") walk(path, out);
      } else if (name.endsWith(".ts")) {
        out.push(path);
      }
    }
    return out;
  }

  it("prices every endpoint the AI handlers log", () => {
    const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
    const logged = new Set<string>();
    for (const file of walk(appDir)) {
      const src = readFileSync(file, "utf8");
      if (!/ai_usage_log|AiUsageLog/.test(src)) continue;
      for (const m of src.matchAll(
        /(?:\bENDPOINT\s*=\s*|\bendpoint:\s*)\n?\s*"([^"]+)"/g,
      )) {
        logged.add(m[1]);
      }
    }
    const priced = new Set<string>(
      Object.values(AI_COSTS).map((entry) => entry.usageEndpoint),
    );
    expect(logged.size).toBeGreaterThanOrEqual(10);
    expect([...logged].filter((e) => !priced.has(e))).toEqual([]);
  });
});
