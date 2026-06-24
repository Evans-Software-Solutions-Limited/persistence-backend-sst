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
});
