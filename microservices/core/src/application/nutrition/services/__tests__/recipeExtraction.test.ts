import { describe, it, expect, vi } from "vitest";
import {
  extractRecipeFromPhoto,
  estimateFoodMacros,
  estimateRecipeMacros,
} from "../recipeExtraction";
import { AiUnreadableError, AiUnavailableError } from "../aiBedrockClient";
import type { MinimalBedrockClient } from "../aiBedrockClient";

const VALID_RECIPE_INPUT = {
  title: "Weeknight Chicken Traybake",
  servings: 4,
  timeMinutes: 45,
  ingredients: [
    { name: "chicken thighs", quantity: 8, unit: "piece" },
    { name: "olive oil", quantity: 2, unit: "tbsp" },
    { name: "salt", quantity: null, unit: null },
  ],
  steps: [
    "Preheat the oven to 200C.",
    "Toss the chicken with oil and salt.",
    "Roast for 40 minutes.",
  ],
  confidence: 0.9,
  notes: null,
};

const VALID_FOOD_MACROS_INPUT = {
  name: "chicken thigh",
  kcal: 209,
  proteinG: 26,
  carbsG: 0,
  fatG: 11,
  confidence: 0.85,
};

function recipeToolUseResponse(input: unknown) {
  return {
    stop_reason: "tool_use" as const,
    content: [
      {
        type: "tool_use" as const,
        name: "report_recipe",
        input,
      },
    ],
  };
}

function foodMacrosToolUseResponse(input: unknown) {
  return {
    stop_reason: "tool_use" as const,
    content: [
      {
        type: "tool_use" as const,
        name: "report_food_macros",
        input,
      },
    ],
  };
}

const VALID_RECIPE_MACROS_INPUT = {
  kcal: 1200,
  proteinG: 60,
  carbsG: 140,
  fatG: 40,
  confidence: 0.7,
};

function recipeMacrosToolUseResponse(input: unknown) {
  return {
    stop_reason: "tool_use" as const,
    content: [
      { type: "tool_use" as const, name: "report_recipe_macros", input },
    ],
  };
}

function fakeClient(
  createImpl: MinimalBedrockClient["messages"]["create"],
): MinimalBedrockClient {
  return { messages: { create: vi.fn(createImpl) } };
}

describe("extractRecipeFromPhoto", () => {
  it("sends forced tool_choice + tool schema + an image content block, using AI_RECIPE_MODEL_ID", async () => {
    const create = vi.fn<MinimalBedrockClient["messages"]["create"]>(async () =>
      recipeToolUseResponse(VALID_RECIPE_INPUT),
    );
    const client: MinimalBedrockClient = { messages: { create } };

    await extractRecipeFromPhoto(
      { imageBase64: "ZmFrZQ==", mediaType: "image/jpeg" },
      { client },
    );

    expect(create).toHaveBeenCalledTimes(1);
    const [params] = create.mock.calls[0];
    expect(params.model).toBe("eu.anthropic.claude-opus-4-6-v1");
    expect(params.tool_choice).toEqual({
      type: "tool",
      name: "report_recipe",
    });
    expect(params.tools).toHaveLength(1);
    expect(params.tools[0].name).toBe("report_recipe");

    const content = params.messages[0].content;
    const imageBlock = content.find((b) => b.type === "image");
    expect(imageBlock).toMatchObject({
      type: "image",
      source: {
        type: "base64",
        media_type: "image/jpeg",
        data: "ZmFrZQ==",
      },
    });
    const textBlock = content.find((b) => b.type === "text");
    expect(
      textBlock && "text" in textBlock ? textBlock.text : undefined,
    ).toContain("DOCUMENT");
  });

  it("returns a well-typed ExtractedRecipe on a happy parse", async () => {
    const client = fakeClient(async () =>
      recipeToolUseResponse(VALID_RECIPE_INPUT),
    );

    const result = await extractRecipeFromPhoto(
      { imageBase64: "ZmFrZQ==", mediaType: "image/png" },
      { client },
    );

    expect(result).toEqual(VALID_RECIPE_INPUT);
  });

  it("coerces missing ingredients/steps arrays to empty arrays rather than rejecting", async () => {
    const client = fakeClient(async () =>
      recipeToolUseResponse({
        title: "Toast",
        servings: null,
        timeMinutes: null,
        confidence: 0.5,
        notes: null,
        // ingredients/steps omitted entirely
      }),
    );

    const result = await extractRecipeFromPhoto(
      { imageBase64: "ZmFrZQ==", mediaType: "image/jpeg" },
      { client },
    );

    expect(result.ingredients).toEqual([]);
    expect(result.steps).toEqual([]);
  });

  it("throws AiUnreadableError when no tool_use block is present", async () => {
    const client = fakeClient(async () => ({
      stop_reason: "end_turn" as const,
      content: [{ type: "text" as const, text: "I cannot help with that." }],
    }));

    await expect(
      extractRecipeFromPhoto(
        { imageBase64: "ZmFrZQ==", mediaType: "image/jpeg" },
        { client },
      ),
    ).rejects.toThrow(AiUnreadableError);
  });

  it("throws AiUnreadableError on an explicit refusal stop_reason", async () => {
    const client = fakeClient(async () => ({
      stop_reason: "refusal" as const,
      content: [],
    }));

    await expect(
      extractRecipeFromPhoto(
        { imageBase64: "ZmFrZQ==", mediaType: "image/jpeg" },
        { client },
      ),
    ).rejects.toThrow(AiUnreadableError);
  });

  it("throws AiUnreadableError when the tool input doesn't match the ExtractedRecipe shape", async () => {
    const client = fakeClient(async () =>
      recipeToolUseResponse({ title: 42, servings: null }),
    );

    await expect(
      extractRecipeFromPhoto(
        { imageBase64: "ZmFrZQ==", mediaType: "image/jpeg" },
        { client },
      ),
    ).rejects.toThrow(AiUnreadableError);
  });

  it("throws AiUnreadableError when an ingredient is missing a required field", async () => {
    const client = fakeClient(async () =>
      recipeToolUseResponse({
        ...VALID_RECIPE_INPUT,
        ingredients: [{ quantity: 1, unit: "cup" }], // missing name
      }),
    );

    await expect(
      extractRecipeFromPhoto(
        { imageBase64: "ZmFrZQ==", mediaType: "image/jpeg" },
        { client },
      ),
    ).rejects.toThrow(AiUnreadableError);
  });

  it("rejects non-finite numbers (NaN servings)", async () => {
    const client = fakeClient(async () =>
      recipeToolUseResponse({
        ...VALID_RECIPE_INPUT,
        servings: Number.NaN,
      }),
    );

    await expect(
      extractRecipeFromPhoto(
        { imageBase64: "ZmFrZQ==", mediaType: "image/jpeg" },
        { client },
      ),
    ).rejects.toThrow(AiUnreadableError);
  });

  it("rejects non-finite confidence (Infinity)", async () => {
    const client = fakeClient(async () =>
      recipeToolUseResponse({
        ...VALID_RECIPE_INPUT,
        confidence: Number.POSITIVE_INFINITY,
      }),
    );

    await expect(
      extractRecipeFromPhoto(
        { imageBase64: "ZmFrZQ==", mediaType: "image/jpeg" },
        { client },
      ),
    ).rejects.toThrow(AiUnreadableError);
  });

  it("clamps out-of-range confidence to [0,1] instead of rejecting", async () => {
    const client = fakeClient(async () =>
      recipeToolUseResponse({ ...VALID_RECIPE_INPUT, confidence: 1.8 }),
    );

    const result = await extractRecipeFromPhoto(
      { imageBase64: "ZmFrZQ==", mediaType: "image/jpeg" },
      { client },
    );

    expect(result.confidence).toBe(1);
  });

  it("retries once on a 5xx error and succeeds on the second attempt", async () => {
    const serverError = Object.assign(new Error("internal error"), {
      status: 500,
    });
    const create = vi
      .fn()
      .mockRejectedValueOnce(serverError)
      .mockResolvedValueOnce(recipeToolUseResponse(VALID_RECIPE_INPUT));
    const client: MinimalBedrockClient = { messages: { create } };

    const result = await extractRecipeFromPhoto(
      { imageBase64: "ZmFrZQ==", mediaType: "image/jpeg" },
      { client },
    );

    expect(create).toHaveBeenCalledTimes(2);
    expect(result).toEqual(VALID_RECIPE_INPUT);
  });

  it("throws AiUnavailableError when both attempts fail", async () => {
    const serverError = Object.assign(new Error("still down"), {
      status: 503,
    });
    const create = vi.fn().mockRejectedValue(serverError);
    const client: MinimalBedrockClient = { messages: { create } };

    await expect(
      extractRecipeFromPhoto(
        { imageBase64: "ZmFrZQ==", mediaType: "image/jpeg" },
        { client },
      ),
    ).rejects.toThrow(AiUnavailableError);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("throws AiUnreadableError when the tool input is null (non-object)", async () => {
    const client = fakeClient(async () => recipeToolUseResponse(null));

    await expect(
      extractRecipeFromPhoto(
        { imageBase64: "ZmFrZQ==", mediaType: "image/jpeg" },
        { client },
      ),
    ).rejects.toThrow(AiUnreadableError);
  });

  it("throws AiUnreadableError when the tool input is a primitive (not an object)", async () => {
    const client = fakeClient(async () =>
      recipeToolUseResponse("not-an-object"),
    );

    await expect(
      extractRecipeFromPhoto(
        { imageBase64: "ZmFrZQ==", mediaType: "image/jpeg" },
        { client },
      ),
    ).rejects.toThrow(AiUnreadableError);
  });

  it("rejects when timeMinutes is Infinity (non-finite)", async () => {
    const client = fakeClient(async () =>
      recipeToolUseResponse({
        ...VALID_RECIPE_INPUT,
        timeMinutes: Number.POSITIVE_INFINITY,
      }),
    );

    await expect(
      extractRecipeFromPhoto(
        { imageBase64: "ZmFrZQ==", mediaType: "image/jpeg" },
        { client },
      ),
    ).rejects.toThrow(AiUnreadableError);
  });

  it("rejects when confidence is NaN", async () => {
    const client = fakeClient(async () =>
      recipeToolUseResponse({
        ...VALID_RECIPE_INPUT,
        confidence: Number.NaN,
      }),
    );

    await expect(
      extractRecipeFromPhoto(
        { imageBase64: "ZmFrZQ==", mediaType: "image/jpeg" },
        { client },
      ),
    ).rejects.toThrow(AiUnreadableError);
  });

  it("rejects when servings is the wrong type entirely (a string, not null/number)", async () => {
    const client = fakeClient(async () =>
      recipeToolUseResponse({ ...VALID_RECIPE_INPUT, servings: "four" }),
    );

    await expect(
      extractRecipeFromPhoto(
        { imageBase64: "ZmFrZQ==", mediaType: "image/jpeg" },
        { client },
      ),
    ).rejects.toThrow(AiUnreadableError);
  });

  it("rejects when ingredients is present but not an array", async () => {
    const client = fakeClient(async () =>
      recipeToolUseResponse({
        ...VALID_RECIPE_INPUT,
        ingredients: "not-an-array",
      }),
    );

    await expect(
      extractRecipeFromPhoto(
        { imageBase64: "ZmFrZQ==", mediaType: "image/jpeg" },
        { client },
      ),
    ).rejects.toThrow(AiUnreadableError);
  });

  it("rejects when steps is present but not an array", async () => {
    const client = fakeClient(async () =>
      recipeToolUseResponse({ ...VALID_RECIPE_INPUT, steps: "not-an-array" }),
    );

    await expect(
      extractRecipeFromPhoto(
        { imageBase64: "ZmFrZQ==", mediaType: "image/jpeg" },
        { client },
      ),
    ).rejects.toThrow(AiUnreadableError);
  });

  it("rejects when a steps entry is not a string", async () => {
    const client = fakeClient(async () =>
      recipeToolUseResponse({
        ...VALID_RECIPE_INPUT,
        steps: ["A valid step.", 5],
      }),
    );

    await expect(
      extractRecipeFromPhoto(
        { imageBase64: "ZmFrZQ==", mediaType: "image/jpeg" },
        { client },
      ),
    ).rejects.toThrow(AiUnreadableError);
  });

  it("rejects when an ingredient entry is not an object", async () => {
    const client = fakeClient(async () =>
      recipeToolUseResponse({
        ...VALID_RECIPE_INPUT,
        ingredients: ["just a string, not an ingredient object"],
      }),
    );

    await expect(
      extractRecipeFromPhoto(
        { imageBase64: "ZmFrZQ==", mediaType: "image/jpeg" },
        { client },
      ),
    ).rejects.toThrow(AiUnreadableError);
  });

  it("rejects when an ingredient's unit is the wrong type (a number, not null/string)", async () => {
    const client = fakeClient(async () =>
      recipeToolUseResponse({
        ...VALID_RECIPE_INPUT,
        ingredients: [{ name: "salt", quantity: 1, unit: 5 }],
      }),
    );

    await expect(
      extractRecipeFromPhoto(
        { imageBase64: "ZmFrZQ==", mediaType: "image/jpeg" },
        { client },
      ),
    ).rejects.toThrow(AiUnreadableError);
  });

  it("rejects when notes is the wrong type (a number, not null/string)", async () => {
    const client = fakeClient(async () =>
      recipeToolUseResponse({ ...VALID_RECIPE_INPUT, notes: 42 }),
    );

    await expect(
      extractRecipeFromPhoto(
        { imageBase64: "ZmFrZQ==", mediaType: "image/jpeg" },
        { client },
      ),
    ).rejects.toThrow(AiUnreadableError);
  });

  it("coerces truly-missing (undefined, not null) nullable fields to null rather than rejecting", async () => {
    // omit servings/timeMinutes/notes at the recipe level AND
    // quantity/unit on an ingredient entirely (as opposed to explicit
    // `null`) — the `value === undefined` side of the nullable coercion
    // OR-check needs its own exercise separate from the explicit-null
    // side already covered by VALID_RECIPE_INPUT's "salt" entry.
    const client = fakeClient(async () =>
      recipeToolUseResponse({
        title: "Toast",
        ingredients: [{ name: "bread" }],
        steps: ["Toast it."],
        confidence: 0.4,
      }),
    );

    const result = await extractRecipeFromPhoto(
      { imageBase64: "ZmFrZQ==", mediaType: "image/jpeg" },
      { client },
    );

    expect(result.servings).toBeNull();
    expect(result.timeMinutes).toBeNull();
    expect(result.notes).toBeNull();
    expect(result.ingredients[0]).toEqual({
      name: "bread",
      quantity: null,
      unit: null,
    });
  });
});

describe("estimateFoodMacros", () => {
  it("sends the food name in a text-only content block with forced tool use, using AI_TEXT_MODEL_ID", async () => {
    const create = vi
      .fn()
      .mockResolvedValue(foodMacrosToolUseResponse(VALID_FOOD_MACROS_INPUT));
    const client: MinimalBedrockClient = { messages: { create } };

    await estimateFoodMacros({ name: "chicken thigh" }, { client });

    expect(create).toHaveBeenCalledTimes(1);
    const [params] = create.mock.calls[0];
    expect(params.model).toBe("eu.anthropic.claude-haiku-4-5-20251001-v1:0");
    expect(params.tool_choice).toEqual({
      type: "tool",
      name: "report_food_macros",
    });
    expect(params.messages[0].content).toHaveLength(1);
    expect(params.messages[0].content[0].type).toBe("text");
    expect(params.messages[0].content[0].text).toContain("chicken thigh");
  });

  it("returns a well-typed EstimatedFoodMacros on a happy parse", async () => {
    const client = fakeClient(async () =>
      foodMacrosToolUseResponse(VALID_FOOD_MACROS_INPUT),
    );

    const result = await estimateFoodMacros(
      { name: "chicken thigh" },
      { client },
    );

    expect(result).toEqual(VALID_FOOD_MACROS_INPUT);
  });

  it("throws AiUnreadableError when no tool_use block is present", async () => {
    const client = fakeClient(async () => ({
      stop_reason: "end_turn" as const,
      content: [{ type: "text" as const, text: "unable to parse" }],
    }));

    await expect(
      estimateFoodMacros({ name: "mystery food" }, { client }),
    ).rejects.toThrow(AiUnreadableError);
  });

  it("throws AiUnreadableError on an explicit refusal stop_reason", async () => {
    const client = fakeClient(async () => ({
      stop_reason: "refusal" as const,
      content: [],
    }));

    await expect(
      estimateFoodMacros({ name: "something" }, { client }),
    ).rejects.toThrow(AiUnreadableError);
  });

  it("rejects non-finite numbers (NaN kcal)", async () => {
    const client = fakeClient(async () =>
      foodMacrosToolUseResponse({
        ...VALID_FOOD_MACROS_INPUT,
        kcal: Number.NaN,
      }),
    );

    await expect(
      estimateFoodMacros({ name: "chicken thigh" }, { client }),
    ).rejects.toThrow(AiUnreadableError);
  });

  it("clamps negative macros to 0 instead of rejecting", async () => {
    const client = fakeClient(async () =>
      foodMacrosToolUseResponse({
        ...VALID_FOOD_MACROS_INPUT,
        fatG: -3,
        confidence: 1.5,
      }),
    );

    const result = await estimateFoodMacros(
      { name: "chicken thigh" },
      { client },
    );

    expect(result.fatG).toBe(0);
    expect(result.confidence).toBe(1);
  });

  it("throws AiUnavailableError when both attempts fail", async () => {
    const serverError = Object.assign(new Error("still down"), {
      status: 503,
    });
    const create = vi.fn().mockRejectedValue(serverError);
    const client: MinimalBedrockClient = { messages: { create } };

    await expect(
      estimateFoodMacros({ name: "chicken thigh" }, { client }),
    ).rejects.toThrow(AiUnavailableError);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("retries once on a timeout-shaped error (no status) and succeeds", async () => {
    const timeoutError = new Error("The operation was aborted");
    const create = vi
      .fn()
      .mockRejectedValueOnce(timeoutError)
      .mockResolvedValueOnce(
        foodMacrosToolUseResponse(VALID_FOOD_MACROS_INPUT),
      );
    const client: MinimalBedrockClient = { messages: { create } };

    const result = await estimateFoodMacros(
      { name: "chicken thigh" },
      { client },
    );

    expect(create).toHaveBeenCalledTimes(2);
    expect(result).toEqual(VALID_FOOD_MACROS_INPUT);
  });

  it("throws AiUnreadableError when the tool input is null (non-object)", async () => {
    const client = fakeClient(async () => foodMacrosToolUseResponse(null));

    await expect(
      estimateFoodMacros({ name: "chicken thigh" }, { client }),
    ).rejects.toThrow(AiUnreadableError);
  });

  it("throws AiUnreadableError when the tool input is a primitive (not an object)", async () => {
    const client = fakeClient(async () =>
      foodMacrosToolUseResponse("not-an-object"),
    );

    await expect(
      estimateFoodMacros({ name: "chicken thigh" }, { client }),
    ).rejects.toThrow(AiUnreadableError);
  });

  it("rejects when name is the wrong type (not a string)", async () => {
    const client = fakeClient(async () =>
      foodMacrosToolUseResponse({ ...VALID_FOOD_MACROS_INPUT, name: 42 }),
    );

    await expect(
      estimateFoodMacros({ name: "chicken thigh" }, { client }),
    ).rejects.toThrow(AiUnreadableError);
  });

  it("rejects non-finite numbers (Infinity proteinG)", async () => {
    const client = fakeClient(async () =>
      foodMacrosToolUseResponse({
        ...VALID_FOOD_MACROS_INPUT,
        proteinG: Number.POSITIVE_INFINITY,
      }),
    );

    await expect(
      estimateFoodMacros({ name: "chicken thigh" }, { client }),
    ).rejects.toThrow(AiUnreadableError);
  });
});

describe("estimateRecipeMacros", () => {
  it("sends name + servings + ingredient lines with forced tool use, using AI_TEXT_MODEL_ID", async () => {
    const create = vi
      .fn()
      .mockResolvedValue(
        recipeMacrosToolUseResponse(VALID_RECIPE_MACROS_INPUT),
      );
    const client: MinimalBedrockClient = { messages: { create } };

    await estimateRecipeMacros(
      {
        name: "Chicken Curry",
        ingredients: ["500g chicken", "1 onion"],
        servings: 4,
      },
      { client },
    );

    expect(create).toHaveBeenCalledTimes(1);
    const [params] = create.mock.calls[0];
    expect(params.model).toBe("eu.anthropic.claude-haiku-4-5-20251001-v1:0");
    expect(params.tool_choice).toEqual({
      type: "tool",
      name: "report_recipe_macros",
    });
    const text = params.messages[0].content[0].text as string;
    expect(text).toContain("Chicken Curry");
    expect(text).toContain("Servings: 4");
    expect(text).toContain("- 500g chicken");
    expect(text).toContain("- 1 onion");
  });

  it("returns a well-typed EstimatedRecipeMacros on a happy parse", async () => {
    const client = fakeClient(async () =>
      recipeMacrosToolUseResponse(VALID_RECIPE_MACROS_INPUT),
    );
    const result = await estimateRecipeMacros(
      { name: "Curry", ingredients: ["x"], servings: 2 },
      { client },
    );
    expect(result).toEqual(VALID_RECIPE_MACROS_INPUT);
  });

  it("handles an empty ingredient list and omits the servings line", async () => {
    const create = vi
      .fn()
      .mockResolvedValue(
        recipeMacrosToolUseResponse(VALID_RECIPE_MACROS_INPUT),
      );
    const client: MinimalBedrockClient = { messages: { create } };

    await estimateRecipeMacros(
      { name: "Mystery", ingredients: [], servings: null },
      { client },
    );

    const text = create.mock.calls[0][0].messages[0].content[0].text as string;
    expect(text).toContain("(no ingredient list provided)");
    expect(text).not.toContain("Servings:");
  });

  it("clamps negative macros to 0 and out-of-range confidence to [0,1]", async () => {
    const client = fakeClient(async () =>
      recipeMacrosToolUseResponse({
        kcal: -50,
        proteinG: 10,
        carbsG: 20,
        fatG: 5,
        confidence: 1.4,
      }),
    );
    const result = await estimateRecipeMacros(
      { name: "R", ingredients: ["x"] },
      { client },
    );
    expect(result.kcal).toBe(0);
    expect(result.confidence).toBe(1);
  });

  it("throws AiUnreadableError when no tool_use block is present", async () => {
    const client = fakeClient(async () => ({
      stop_reason: "end_turn" as const,
      content: [{ type: "text" as const, text: "nope" }],
    }));
    await expect(
      estimateRecipeMacros({ name: "R", ingredients: ["x"] }, { client }),
    ).rejects.toThrow(AiUnreadableError);
  });

  it("throws AiUnreadableError when the tool input is not an object", async () => {
    const client = fakeClient(async () => recipeMacrosToolUseResponse(null));
    await expect(
      estimateRecipeMacros({ name: "R", ingredients: ["x"] }, { client }),
    ).rejects.toThrow(AiUnreadableError);
  });

  it("rejects a non-finite macro (NaN kcal)", async () => {
    const client = fakeClient(async () =>
      recipeMacrosToolUseResponse({
        ...VALID_RECIPE_MACROS_INPUT,
        kcal: Number.NaN,
      }),
    );
    await expect(
      estimateRecipeMacros({ name: "R", ingredients: ["x"] }, { client }),
    ).rejects.toThrow(AiUnreadableError);
  });

  it("throws AiUnavailableError when the model call keeps failing", async () => {
    const client = fakeClient(async () => {
      throw Object.assign(new Error("boom"), { status: 500 });
    });
    await expect(
      estimateRecipeMacros({ name: "R", ingredients: ["x"] }, { client }),
    ).rejects.toThrow(AiUnavailableError);
  });
});
