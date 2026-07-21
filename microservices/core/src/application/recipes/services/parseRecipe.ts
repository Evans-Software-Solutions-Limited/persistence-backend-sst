/**
 * Deterministic Schema.org Recipe extractor (M9 — no AI). Parses
 * `application/ld+json` blocks from the fetched HTML and pulls out the first
 * node typed `Recipe`. Returns null when no Recipe microdata is present — the
 * handler maps that to 422 `no_recipe_microdata` (the LLM-fallback extraction
 * is deferred to M9.5 per Conflict C3).
 */

/**
 * Per-serving macros lifted from a Schema.org `NutritionInformation` node.
 * All fields are optional — recipe sites publish these unevenly (many give
 * `calories` but omit one or more macros). `null` means "not present on the
 * page"; the caller decides how to treat a partial set. Values are PER SERVING
 * (the Schema.org convention for `Recipe.nutrition`).
 */
export type ParsedNutrition = {
  kcal: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
};

export type ParsedRecipe = {
  name: string;
  servings: number | null;
  instructions: string | null;
  ingredients: string[];
  /** Per-serving macros when the page publishes `Recipe.nutrition`, else null. */
  nutrition: ParsedNutrition | null;
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

/**
 * Extract the leading numeric value from a Schema.org nutrition field.
 * These arrive as strings like `"270 calories"`, `"9 g"`, `"11.5g"`, or
 * occasionally as bare numbers. Returns the first non-negative finite number
 * found, or null. A leading currency/garbage token → null (we only trust a
 * clean leading number).
 *
 * Comma handling: a comma before exactly 3 digits (with a non-digit or string
 * end after) is a thousands separator and is stripped (`"1,200"` → 1200,
 * `"1,200,000"` → 1000000). A comma before 1–2 digits is a European decimal
 * point and becomes `.` (`"11,5 g"` → 11.5). Ambiguous `"1,500"` resolves to
 * 1500 (thousands wins on a 3-digit group).
 */
function parseNutritionValue(v: any): number | null {
  if (typeof v === "number") {
    return Number.isFinite(v) && v >= 0 ? v : null;
  }
  if (typeof v !== "string") return null;
  const cleaned = v
    .replace(/(\d),(?=\d{3}(\D|$))/g, "$1") // thousands separator → strip
    .replace(/(\d),(\d{1,2})(?!\d)/, "$1.$2"); // European decimal → point
  const m = cleaned.match(/^\s*(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Read a Schema.org `NutritionInformation` node into per-serving macros.
 * Returns null when no node is present OR when every macro field is missing
 * (an all-null result carries no signal and shouldn't override anything
 * downstream). A partial set (e.g. calories only) is kept — the caller can
 * still surface what was published.
 */
function parseNutrition(v: any): ParsedNutrition | null {
  const node = Array.isArray(v) ? v[0] : v;
  if (!node || typeof node !== "object") return null;

  const nutrition: ParsedNutrition = {
    kcal: parseNutritionValue(node.calories),
    proteinG: parseNutritionValue(node.proteinContent),
    carbsG: parseNutritionValue(node.carbohydrateContent),
    fatG: parseNutritionValue(node.fatContent),
  };

  const allMissing =
    nutrition.kcal === null &&
    nutrition.proteinG === null &&
    nutrition.carbsG === null &&
    nutrition.fatG === null;
  return allMissing ? null : nutrition;
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
      nutrition: parseNutrition(recipe.nutrition),
    };
  }
  return null;
}
