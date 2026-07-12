import { describe, it, expect, vi } from "vitest";
import { resolveIngredientFood } from "../resolveIngredientFood";
import type { FoodDTO } from "../../../repositories/foodRepository";
import type { MinimalBedrockClient } from "../aiBedrockClient";

const FAKE_FOOD: FoodDTO = {
  id: "food-1",
  name: "chicken thigh",
  brand: null,
  barcode: null,
  kcal: 209,
  proteinG: 26,
  carbsG: 0,
  fatG: 11,
  servingSize: 100,
  servingUnit: "g",
  source: "ai_recognized",
  createdBy: "user-1",
};

describe("resolveIngredientFood", () => {
  it("estimates macros then creates a food with source 'ai_recognized' and servingSize 100 g", async () => {
    const estimate = vi.fn(async () => ({
      name: "chicken thigh",
      kcal: 209,
      proteinG: 26,
      carbsG: 0,
      fatG: 11,
      confidence: 0.85,
    }));
    const create = vi.fn(async () => FAKE_FOOD);

    const result = await resolveIngredientFood("chicken thigh", "user-1", {
      foodRepo: { create },
      estimate,
    });

    expect(estimate).toHaveBeenCalledWith(
      { name: "chicken thigh" },
      { client: undefined },
    );
    expect(create).toHaveBeenCalledWith("user-1", {
      name: "chicken thigh",
      kcal: 209,
      proteinG: 26,
      carbsG: 0,
      fatG: 11,
      servingSize: 100,
      servingUnit: "g",
      source: "ai_recognized",
    });
    expect(result).toEqual({ food: FAKE_FOOD, source: "ai" });
  });

  it("propagates AiUnreadableError/AiUnavailableError from the estimate step", async () => {
    class FakeAiUnreadableError extends Error {}
    const estimate = vi.fn(async () => {
      throw new FakeAiUnreadableError("model refused");
    });
    const create = vi.fn(async () => FAKE_FOOD);

    await expect(
      resolveIngredientFood("mystery food", "user-1", {
        foodRepo: { create },
        estimate,
      }),
    ).rejects.toThrow(FakeAiUnreadableError);
    expect(create).not.toHaveBeenCalled();
  });

  it("falls back to the real estimateFoodMacros when deps.estimate is omitted", async () => {
    // No `estimate` key at all — exercises the `deps.estimate ??
    // estimateFoodMacros` default branch. A fake Bedrock client is
    // injected via `deps.client` so the REAL estimateFoodMacros runs
    // without ever hitting the network.
    const create = vi.fn(async () => FAKE_FOOD);
    const fakeClient: MinimalBedrockClient = {
      messages: {
        create: vi.fn(async () => ({
          stop_reason: "tool_use" as const,
          content: [
            {
              type: "tool_use" as const,
              name: "report_food_macros",
              input: {
                name: "chicken thigh",
                kcal: 209,
                proteinG: 26,
                carbsG: 0,
                fatG: 11,
                confidence: 0.85,
              },
            },
          ],
        })),
      },
    };

    const result = await resolveIngredientFood("chicken thigh", "user-1", {
      foodRepo: { create },
      client: fakeClient,
    });

    expect(fakeClient.messages.create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith("user-1", {
      name: "chicken thigh",
      kcal: 209,
      proteinG: 26,
      carbsG: 0,
      fatG: 11,
      servingSize: 100,
      servingUnit: "g",
      source: "ai_recognized",
    });
    expect(result).toEqual({ food: FAKE_FOOD, source: "ai" });
  });

  it("passes deps.client through to an injected estimate function when provided", async () => {
    const fakeClient: MinimalBedrockClient = {
      messages: { create: vi.fn() },
    };
    const estimate = vi.fn(async () => ({
      name: "chicken thigh",
      kcal: 209,
      proteinG: 26,
      carbsG: 0,
      fatG: 11,
      confidence: 0.85,
    }));
    const create = vi.fn(async () => FAKE_FOOD);

    await resolveIngredientFood("chicken thigh", "user-1", {
      foodRepo: { create },
      estimate,
      client: fakeClient,
    });

    expect(estimate).toHaveBeenCalledWith(
      { name: "chicken thigh" },
      { client: fakeClient },
    );
  });
});
