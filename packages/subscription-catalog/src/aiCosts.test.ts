import { describe, expect, it } from "vitest";
import {
  AI_COSTS,
  MAX_COST_PER_CALL_USD,
  costPerCall,
  costPerUsageEndpoint,
} from "./aiCosts";

describe("AI cost table", () => {
  it("prices a call from its token shape at list price", () => {
    expect(
      costPerCall({
        model: "opus",
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        measured: false,
        basis: "",
      }),
    ).toBe(30);
    expect(
      costPerCall({
        model: "haiku",
        inputTokens: 1_000_000,
        outputTokens: 0,
        measured: false,
        basis: "",
      }),
    ).toBe(1);
  });

  it("keeps the two measured Phase E costs", () => {
    expect(costPerCall(AI_COSTS.loadout_remap.profile)).toBeCloseTo(0.0057, 4);
    expect(costPerCall(AI_COSTS.equipment_scan.profile)).toBeCloseTo(0.0272, 4);
  });

  it("looks a cost up by the ai_usage_log endpoint string", () => {
    expect(costPerUsageEndpoint("/nutrition/ai/estimate")).toBeCloseTo(
      0.0155,
      4,
    );
    expect(costPerUsageEndpoint("resolve-ingredient")).toBeCloseTo(0.0008, 4);
  });

  it("prices an unknown endpoint at the most expensive call, never zero", () => {
    expect(costPerUsageEndpoint("/not/in/the/table")).toBe(
      MAX_COST_PER_CALL_USD,
    );
    expect(MAX_COST_PER_CALL_USD).toBeCloseTo(
      costPerCall(AI_COSTS.recipe_extract.profile),
      6,
    );
  });

  it("has one entry per usage endpoint and keys that match", () => {
    const entries = Object.entries(AI_COSTS);
    const endpoints = new Set(entries.map(([, e]) => e.usageEndpoint));
    expect(endpoints.size).toBe(entries.length);
    for (const [key, entry] of entries) expect(entry.key).toBe(key);
  });
});
