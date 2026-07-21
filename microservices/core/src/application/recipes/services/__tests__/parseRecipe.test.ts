import { describe, it, expect } from "vitest";
import { parseRecipeFromHtml } from "../parseRecipe";

const wrap = (json: string) =>
  `<html><head><script type="application/ld+json">${json}</script></head></html>`;

describe("parseRecipeFromHtml", () => {
  it("parses a single Recipe object", () => {
    const out = parseRecipeFromHtml(
      wrap(
        JSON.stringify({
          "@type": "Recipe",
          name: "Chicken Rice Bowl",
          recipeYield: "4 servings",
          recipeIngredient: ["200g rice", "2 chicken breasts"],
          recipeInstructions: ["Cook rice", "Grill chicken"],
        }),
      ),
    );
    expect(out).toEqual({
      name: "Chicken Rice Bowl",
      servings: 4,
      instructions: "Cook rice\nGrill chicken",
      ingredients: ["200g rice", "2 chicken breasts"],
      nutrition: null,
    });
  });

  it("finds a Recipe inside @graph and reads HowToStep instructions", () => {
    const out = parseRecipeFromHtml(
      wrap(
        JSON.stringify({
          "@graph": [
            { "@type": "WebPage" },
            {
              "@type": ["Recipe", "NewsArticle"],
              name: "Shakshuka",
              recipeYield: 2,
              recipeIngredient: ["4 eggs"],
              recipeInstructions: [
                { "@type": "HowToStep", text: "Fry onions" },
                { "@type": "HowToStep", text: "Add eggs" },
              ],
            },
          ],
        }),
      ),
    );
    expect(out?.name).toBe("Shakshuka");
    expect(out?.servings).toBe(2);
    expect(out?.instructions).toBe("Fry onions\nAdd eggs");
    expect(out?.ingredients).toEqual(["4 eggs"]);
  });

  it("handles an array payload + string instructions", () => {
    const out = parseRecipeFromHtml(
      wrap(
        JSON.stringify([
          { "@type": "Organization" },
          {
            "@type": "Recipe",
            name: "Toast",
            recipeIngredient: "1 slice bread",
            recipeInstructions: "Toast it",
          },
        ]),
      ),
    );
    expect(out?.ingredients).toEqual(["1 slice bread"]);
    expect(out?.instructions).toBe("Toast it");
    expect(out?.servings).toBeNull();
  });

  it("skips malformed ld+json blocks and still finds a later valid one", () => {
    const html =
      `<script type="application/ld+json">{ not json }</script>` +
      wrap(JSON.stringify({ "@type": "Recipe", name: "Valid" }));
    expect(parseRecipeFromHtml(html)?.name).toBe("Valid");
  });

  it("returns null when there is no Recipe microdata", () => {
    expect(
      parseRecipeFromHtml(wrap(JSON.stringify({ "@type": "WebPage" }))),
    ).toBeNull();
    expect(parseRecipeFromHtml("<html>no scripts</html>")).toBeNull();
  });

  describe("nutrition", () => {
    const withNutrition = (nutrition: unknown) =>
      parseRecipeFromHtml(
        wrap(
          JSON.stringify({
            "@type": "Recipe",
            name: "N",
            recipeIngredient: ["x"],
            nutrition,
          }),
        ),
      )?.nutrition;

    it("parses per-serving macros from a NutritionInformation node", () => {
      expect(
        withNutrition({
          "@type": "NutritionInformation",
          calories: "270 calories",
          proteinContent: "9 g",
          carbohydrateContent: "35 g",
          fatContent: "11 g",
        }),
      ).toEqual({ kcal: 270, proteinG: 9, carbsG: 35, fatG: 11 });
    });

    it("handles bare numbers, decimals, 'kcal', and thousands commas", () => {
      expect(
        withNutrition({
          calories: "1,200 kcal",
          proteinContent: 42,
          fatContent: "11.5g",
        }),
      ).toEqual({ kcal: 1200, proteinG: 42, carbsG: null, fatG: 11.5 });
    });

    it("handles European decimal commas and multi-group thousands", () => {
      expect(
        withNutrition({
          calories: "1,200,000", // two thousands groups
          proteinContent: "11,5 g", // European decimal
          carbohydrateContent: "1,5", // European decimal, no unit
          fatContent: "1,500 g", // ambiguous → thousands wins
        }),
      ).toEqual({ kcal: 1200000, proteinG: 11.5, carbsG: 1.5, fatG: 1500 });
    });

    it("keeps a partial set (calories only)", () => {
      expect(withNutrition({ calories: "500 calories" })).toEqual({
        kcal: 500,
        proteinG: null,
        carbsG: null,
        fatG: null,
      });
    });

    it("takes the first element when nutrition is an array", () => {
      expect(withNutrition([{ calories: "100" }, { calories: "999" }])).toEqual(
        { kcal: 100, proteinG: null, carbsG: null, fatG: null },
      );
    });

    it("returns null when the node has no usable macro fields", () => {
      expect(withNutrition({ servingSize: "1 bowl" })).toBeNull();
      expect(withNutrition({ calories: "not a number" })).toBeNull();
      expect(withNutrition(null)).toBeNull();
      expect(withNutrition("240 calories")).toBeNull();
    });

    it("is null when the Recipe omits nutrition entirely", () => {
      expect(
        parseRecipeFromHtml(
          wrap(
            JSON.stringify({
              "@type": "Recipe",
              name: "N",
              recipeIngredient: ["x"],
            }),
          ),
        )?.nutrition,
      ).toBeNull();
    });
  });
});
