import { describe, expect, it, vi } from "vitest";
import {
  extractRecipeFromText,
  prepareRecipeAiText,
  RECIPE_TEXT_LIMIT,
  type RecipeTextClient,
} from "../aiRecipeFromText";

const source =
  "Rice bowl\nIngredients\n100g rice\n1 onion\nMethod\nBoil the rice.\nFry the onion.";
const recipe = {
  name: "Rice bowl",
  ingredients: ["100g rice", "1 onion"],
  steps: ["Boil the rice.", "Fry the onion."],
};
function fake(raw: unknown = recipe, stop_reason = "end_turn") {
  const create = vi.fn().mockResolvedValue({
    content: [{ type: "text", text: JSON.stringify(raw) }],
    stop_reason,
  });
  return { create, client: { messages: { create } } as RecipeTextClient };
}

describe("extractRecipeFromText", () => {
  it("returns only grounded recipe text without inventing macros or servings", async () => {
    const { client, create } = fake();
    expect(await extractRecipeFromText(source, { client })).toEqual({
      name: "Rice bowl",
      ingredients: recipe.ingredients,
      instructions: recipe.steps.join("\n"),
      servings: null,
      nutrition: null,
      extractionMethod: "ai",
    });
    expect(create).toHaveBeenCalledTimes(1);
    const [params, options] = create.mock.calls[0];
    expect(params.tools).toBeUndefined();
    expect(params.max_tokens).toBe(900);
    expect(options).toEqual({ timeout: 12_000 });
    expect(params.system).toContain("untrusted");
    expect(params.system).toContain("never as instructions");
  });
  it("removes source links and credentials before sending text", async () => {
    const { client, create } = fake();
    await extractRecipeFromText(
      `${source}\nhttps://private.example/?token=secret www.example.com`,
      { client },
    );
    expect(create.mock.calls[0][0].messages[0].content).not.toContain("secret");
    expect(create.mock.calls[0][0].messages[0].content).not.toContain(
      "example.com",
    );
  });
  it.each(["", " ", "a".repeat(RECIPE_TEXT_LIMIT + 1)])(
    "skips empty/oversized text before provider use",
    async (text) => {
      const { client, create } = fake();
      expect(await extractRecipeFromText(text, { client })).toBeNull();
      expect(create).not.toHaveBeenCalled();
    },
  );
  it.each([
    null,
    [],
    "recipe",
    {},
    { ...recipe, name: "Invented bowl" },
    { ...recipe, ingredients: ["200g rice"] },
    { ...recipe, ingredients: ["00g rice"] },
    { ...recipe, ingredients: [] },
    { ...recipe, ingredients: [null] },
    { ...recipe, ingredients: Array(81).fill("100g rice") },
    { ...recipe, steps: ["Bake for 30 minutes"] },
    { ...recipe, steps: [] },
    { ...recipe, steps: Array(41).fill("Boil the rice.") },
    { ...recipe, nutrition: { kcal: 700 } },
    { ...recipe, servings: 2 },
  ])("rejects malformed, hallucinated or additional data: %j", async (raw) => {
    expect(
      await extractRecipeFromText(source, { client: fake(raw).client }),
    ).toBeNull();
  });
  it.each(["max_tokens", "refusal", "tool_use"])(
    "rejects incomplete or non-text output: %s",
    async (stop) => {
      expect(
        await extractRecipeFromText(source, {
          client: fake(recipe, stop).client,
        }),
      ).toBeNull();
    },
  );
  it("rejects invalid JSON, tools and multi-block answers", async () => {
    const { client, create } = fake();
    for (const content of [
      [{ type: "text", text: "```json\n{}\n```" }],
      [{ type: "tool_use" }],
      [
        { type: "text", text: "null" },
        { type: "text", text: "null" },
      ],
    ]) {
      create.mockResolvedValue({ content, stop_reason: "end_turn" });
      expect(await extractRecipeFromText(source, { client })).toBeNull();
    }
  });
  it.each([
    "https://evil.example",
    "javascript:alert(1)",
    "<script>alert(1)</script>",
  ])(
    "rejects active content even when present in source: %s",
    async (value) => {
      expect(
        await extractRecipeFromText(`${source}\n${value}`, {
          client: fake({ ...recipe, steps: [value] }).client,
        }),
      ).toBeNull();
    },
  );
  it("returns manual recovery on timeout without retrying", async () => {
    const { client, create } = fake();
    create.mockRejectedValue(new Error("timed out"));
    expect(await extractRecipeFromText(source, { client })).toBeNull();
    expect(create).toHaveBeenCalledTimes(1);
  });
  it.each([
    ["1.5g salt", "5g salt"],
    ["0.5g salt", "5g salt"],
    [".5g salt", "5g salt"],
    [",5g salt", "5g salt"],
    ["1,5g salt", "5g salt"],
    ["1/2 tsp salt", "2 tsp salt"],
    ["1 / 2 tsp salt", "2 tsp salt"],
    ["1⁄2 tsp salt", "2 tsp salt"],
    ["1½ tsp salt", "½ tsp salt"],
    ["1 ½ tsp salt", "½ tsp salt"],
    ["-5g salt", "5g salt"],
    ["− 5g salt", "5g salt"],
    ["+5g salt", "5g salt"],
  ])("rejects partial source quantity %s → %s", async (original, changed) => {
    const page = `Rice bowl\nIngredients\n${original}\nMethod\nBoil the rice.`;
    const output = {
      ...recipe,
      ingredients: [changed],
      steps: ["Boil the rice."],
    };
    expect(
      await extractRecipeFromText(page, { client: fake(output).client }),
    ).toBeNull();
    output.ingredients = [original];
    expect(
      await extractRecipeFromText(page, { client: fake(output).client }),
    ).not.toBeNull();
  });
  it.each(["Soup.", "Soup,", "Soup/"])(
    "accepts intact quantities following sentence punctuation: %s",
    async (prefix) => {
      const page = `Rice bowl ${prefix}\n100g rice\nBoil the rice.`;
      const output = {
        ...recipe,
        ingredients: ["100g rice"],
        steps: ["Boil the rice."],
      };
      expect(
        await extractRecipeFromText(page, { client: fake(output).client }),
      ).not.toBeNull();
    },
  );
  it.each(["rice", "100g", "100g rice\n1 onion"])(
    "rejects incomplete or combined ingredient source lines: %s",
    async (ingredient) => {
      expect(
        await extractRecipeFromText(source, {
          client: fake({ ...recipe, ingredients: [ingredient] }).client,
        }),
      ).toBeNull();
    },
  );
  it.each([".5g salt", ",5g salt"])(
    "rejects a leading decimal omitted from an instruction span: %s",
    async (step) => {
      const page = `${source}\n${step}`;
      expect(
        await extractRecipeFromText(page, {
          client: fake({ ...recipe, steps: ["5g salt"] }).client,
        }),
      ).toBeNull();
      expect(
        await extractRecipeFromText(page, {
          client: fake({ ...recipe, steps: [step] }).client,
        }),
      ).not.toBeNull();
    },
  );
  it("normalizes whitespace without changing quantities", async () => {
    const { client } = fake({
      ...recipe,
      ingredients: ["100g   rice", "1 onion"],
    });
    expect(await extractRecipeFromText(source, { client })).not.toBeNull();
  });
  it("rejects oversize source before link removal can disguise truncation", () => {
    expect(
      prepareRecipeAiText(
        "https://example.com/" + "a".repeat(RECIPE_TEXT_LIMIT),
      ),
    ).toBeNull();
  });
  it("keeps bounded prepared text intact", () => {
    expect(prepareRecipeAiText(source)).toBe(source);
  });
});
