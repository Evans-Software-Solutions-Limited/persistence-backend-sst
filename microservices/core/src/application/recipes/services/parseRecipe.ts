/**
 * Deterministic Schema.org Recipe extractor (M9 — no AI). Parses
 * `application/ld+json` blocks from the fetched HTML and pulls out the first
 * node typed `Recipe`. Returns null when no Recipe microdata is present — the
 * handler maps that to 422 `no_recipe_microdata` (the LLM-fallback extraction
 * is deferred to M9.5 per Conflict C3).
 */

export type ParsedRecipe = {
  name: string;
  servings: number | null;
  instructions: string | null;
  ingredients: string[];
};

/* eslint-disable @typescript-eslint/no-explicit-any */

function hasRecipeType(node: any): boolean {
  const t = node?.["@type"];
  if (!t) return false;
  return Array.isArray(t) ? t.includes("Recipe") : t === "Recipe";
}

function collectNodes(parsed: any): any[] {
  if (Array.isArray(parsed)) return parsed.flatMap(collectNodes);
  if (parsed && typeof parsed === "object") {
    if (Array.isArray(parsed["@graph"])) {
      return [parsed, ...parsed["@graph"].flatMap(collectNodes)];
    }
    return [parsed];
  }
  return [];
}

function toStringArray(v: any): string[] {
  if (v === undefined || v === null) return [];
  const arr = Array.isArray(v) ? v : [v];
  return arr
    .map((item) => {
      if (typeof item === "string") return item.trim();
      if (item && typeof item === "object" && typeof item.text === "string") {
        return item.text.trim();
      }
      return "";
    })
    .filter((s): s is string => s.length > 0);
}

function parseServings(v: any): number | null {
  const candidate = Array.isArray(v) ? v[0] : v;
  if (typeof candidate === "number" && Number.isFinite(candidate)) {
    return Math.trunc(candidate);
  }
  if (typeof candidate === "string") {
    const m = candidate.match(/\d+/);
    if (m) return Number(m[0]);
  }
  return null;
}

const LD_JSON_RE =
  /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

export function parseRecipeFromHtml(html: string): ParsedRecipe | null {
  const blocks: string[] = [];
  let m: RegExpExecArray | null;
  LD_JSON_RE.lastIndex = 0;
  while ((m = LD_JSON_RE.exec(html)) !== null) blocks.push(m[1]);

  for (const block of blocks) {
    let parsed: any;
    try {
      parsed = JSON.parse(block.trim());
    } catch {
      continue; // skip malformed ld+json blocks
    }
    const recipe = collectNodes(parsed).find(hasRecipeType);
    if (!recipe) continue;

    const instructions = toStringArray(recipe.recipeInstructions);
    return {
      name:
        typeof recipe.name === "string"
          ? recipe.name.trim()
          : "Imported recipe",
      servings: parseServings(recipe.recipeYield),
      instructions: instructions.length > 0 ? instructions.join("\n") : null,
      ingredients: toStringArray(recipe.recipeIngredient),
    };
  }
  return null;
}
