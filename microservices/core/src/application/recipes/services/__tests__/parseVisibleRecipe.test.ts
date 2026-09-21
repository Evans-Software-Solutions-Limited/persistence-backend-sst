import { extractRecipeFromText } from "../aiRecipeFromText";
import { describe, expect, it } from "vitest";
import { parseRecipeFromHtml } from "../parseRecipe";
import { readableRecipeText } from "../parseVisibleRecipe";

// Synthetic fixture uses the heading/list layout of the reported page, not its copyrighted recipe.
const recipe = `<h1>Test &amp; Bean Bowl</h1><div><span>Serves 3</span></div>
<div class="macros"><div><b>300</b><i>Calories</i></div><div><b>20g</b><i>Protein</i></div><div><b>30.5g</b><i>Carbs</i></div><div><b>4g</b><i>Fat</i></div></div>
<p>Per serving, divided three ways</p>
<h2>Ingredients</h2><h3>Base</h3><ul><li>200g beans</li><li>&frac12; tsp salt</li></ul>
<h3>Sauce</h3><ul><li>10g oil</li></ul>
<h2>Method</h2><ol><li><b>Prepare</b><ul><li>Rinse the beans.</li><li>Add salt.</li></ul></li><li>Cook at 180&deg;C.</li></ol>
<form><h2>Sign up</h2><ul><li>Buy my book</li></ul></form>`;

describe("readable HTML recipe fallback", () => {
  it("extracts grouped ingredients, nested steps, servings and explicit per-serving macros", () => {
    expect(parseRecipeFromHtml(recipe)).toEqual({
      name: "Test & Bean Bowl",
      extractionMethod: "page",
      servings: 3,
      ingredients: ["200g beans", "½ tsp salt", "10g oil"],
      instructions: "Prepare Rinse the beans. Add salt.\nCook at 180°C.",
      nutrition: { kcal: 300, proteinG: 20, carbsG: 30.5, fatG: 4 },
    });
  });
  it("still prefers structured recipe metadata", () => {
    const html =
      recipe +
      `<script type="application/ld+json">{"@type":"Recipe","name":"Structured","recipeIngredient":["1 egg"]}</script>`;
    expect(parseRecipeFromHtml(html)?.name).toBe("Structured");
  });
  it("recovers after malformed metadata and handles paragraphs and heading punctuation", () => {
    const result = parseRecipeFromHtml(
      `<script type="application/ld+json">bad</script><h1>Soup</h1><h3>Ingredients:</h3><p>2 beans</p><p>1 litre water</p><h3>Directions</h3><p>Boil.</p><h3>Reviews</h3><p>Great!</p>`,
    );
    expect(result?.ingredients).toEqual(["2 beans", "1 litre water"]);
    expect(result?.instructions).toBe("Boil.");
    expect(result?.nutrition).toBeNull();
    expect(result?.servings).toBeNull();
  });
  it("ignores non-content and explicitly hidden text", () => {
    const hidden = `<nav><h1>Site title</h1></nav><aside><h2>Ingredients</h2></aside><div hidden><h1>Hidden</h1></div><div aria-hidden="true">IGNORE</div><span style="display:none">SECRET</span><span style="visibility: hidden">INVISIBLE</span><style>css</style><script>alert(1)</script><template>bad</template>`;
    expect(parseRecipeFromHtml(hidden + recipe)?.name).toBe("Test & Bean Bowl");
    expect(readableRecipeText(hidden)).toBe("");
  });
  it.each([
    recipe.replace("<h1>", "<h4>").replace("</h1>", "</h4>"),
    recipe + "<h1>Other dish</h1>",
    recipe + "<h2>Ingredients</h2><p>Another dish</p>",
    recipe.replace("<h2>Method</h2>", "<h2>About us</h2>"),
    "<h1>Shopping</h1><h2>Ingredients</h2><p>1 item</p><h2>Method</h2><p>Buy it</p>",
    "<h1></h1><h2>Ingredients</h2><p>one</p><p>two</p><h2>Method</h2><p>mix</p>",
    "<h1>Soup</h1><h2>Ingredients</h2><p>one</p><p>two</p><h2>Method</h2>",
  ])("declines missing or ambiguous recipe sections", (html) => {
    expect(parseRecipeFromHtml(html)).toBeNull();
  });
  it.each(["Per recipe", "Per 100g", "Whole recipe", "Nutrition estimates"])(
    "does not assign %s macros as per-serving",
    (label) => {
      expect(
        parseRecipeFromHtml(recipe.replace("Per serving", label))?.nutrition,
      ).toBeNull();
    },
  );
  it("does not guess conflicting servings or missing macros", () => {
    expect(
      parseRecipeFromHtml(
        recipe.replace(
          "Serves 3</span>",
          "Serves 3</span><span>Serves 5</span>",
        ),
      )?.servings,
    ).toBeNull();
    expect(
      parseRecipeFromHtml(recipe.replace("Serves 3", "Serves 0"))?.servings,
    ).toBeNull();
    expect(
      parseRecipeFromHtml(recipe.replace(/\d+(?:\.\d+)?g/g, "unknown"))
        ?.nutrition,
    ).toEqual({ kcal: 300, proteinG: null, carbsG: null, fatG: null });
  });
  it("does not include link targets and caps text sent to fallback", () => {
    expect(
      readableRecipeText(
        `<p>Hi <a href="http://127.0.0.1/private">beans</a></p>`,
        5,
      ),
    ).toBe("Hi be");
  });
});

it("does not mix a method under a lower-level heading into ingredients", () => {
  const result = parseRecipeFromHtml(
    "<h1>Soup</h1><h2>Ingredients</h2><ul><li>2 beans</li><li>water</li></ul><h3>Method</h3><p>Boil.</p>",
  );
  expect(result?.ingredients).toEqual(["2 beans", "water"]);
  expect(result?.instructions).toBe("Boil.");
});

it("keeps heading boundaries in plain page text", () => {
  expect(
    readableRecipeText(
      "<h1>Soup</h1><h2>Ingredients</h2><ul><li>1 onion</li></ul><h2>Method</h2><p>Boil.</p>",
    ),
  ).toBe("Soup\nIngredients\n1 onion\nMethod\nBoil.");
});
it("normalizes grouped and decimal nutritional numbers consistently", () => {
  expect(
    parseRecipeFromHtml(recipe.replace("300</b>", "1,200</b>"))?.nutrition
      ?.kcal,
  ).toBe(1200);
  expect(
    parseRecipeFromHtml(recipe.replace("30.5g", "30,5g"))?.nutrition?.carbsG,
  ).toBe(30.5);
});
it("does not borrow nutrition or servings from unrelated cards after the recipe", () => {
  const main =
    "<h1>Soup</h1><h2>Ingredients</h2><ul><li>2 beans</li><li>water</li></ul><h2>Method</h2><p>Boil.</p>";
  const result = parseRecipeFromHtml(
    main +
      '<section><h2>Try this too</h2><span>Serves 8</span><div class="macros">500 Calories</div><p>Per serving</p></section>',
  );
  expect(result?.nutrition).toBeNull();
  expect(result?.servings).toBeNull();
});

it("stops recipe instructions at their containing article", () => {
  const result = parseRecipeFromHtml(
    "<article><h1>Soup</h1><h2>Ingredients</h2><p>beans</p><p>water</p><h2>Method</h2><p>Boil.</p></article><div><p>Subscribe to our newsletter.</p></div>",
  );
  expect(result?.instructions).toBe("Boil.");
});

it.each([
  "<li><span>100g</span>\n<span>rice</span></li>",
  "<li><div>100g</div><div>rice</div></li>",
  "<p><span>100g</span>\n<span>rice</span></p>",
])(
  "preserves full semantic ingredient lines through HTML-to-AI validation",
  async (ingredient) => {
    const source = readableRecipeText(
      `<h1>Soup</h1><ul>${ingredient}<li>water</li></ul><p>Boil.</p>`,
    );
    expect(source).toBe("Soup\n100g rice\nwater\nBoil.");
    const result = async (line: string) =>
      extractRecipeFromText(source, {
        client: {
          messages: {
            create: async () => ({
              stop_reason: "end_turn",
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    name: "Soup",
                    ingredients: [line, "water"],
                    steps: ["Boil."],
                  }),
                },
              ],
            }),
          },
        },
      });
    expect(await result("rice")).toBeNull();
    expect((await result("100g rice"))?.ingredients).toEqual([
      "100g rice",
      "water",
    ]);
  },
);
