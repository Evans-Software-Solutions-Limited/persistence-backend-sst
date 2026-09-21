import { parseNutritionValue } from "./parseNutritionValue";
import { parseVisibleRecipe } from "./parseVisibleRecipe";

/**
 * Deterministic Schema.org Recipe extractor (M9 — no AI). Parses
 * `application/ld+json` blocks from the fetched HTML and pulls out the first
 * node typed `Recipe`. Falls back to labelled, readable HTML recipe sections when metadata is absent.
 * Returns null for ambiguous/unreadable pages; no AI-generated recipe content.
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
  extractionMethod?: "structured" | "page" | "ai";
  name: string;
  servings: number | null;
  instructions: string | null;
  ingredients: string[];
  /** Per-serving macros when the page publishes `Recipe.nutrition`, else null. */
  nutrition: ParsedNutrition | null;
};

/* eslint-disable @typescript-eslint/no-explicit-any */

function hasRecipeType(node: any): boolean {
  const types = Array.isArray(node?.["@type"])
    ? node["@type"]
    : [node?.["@type"]];
  return types.some((type: unknown) =>
    [
      "Recipe",
      "https://schema.org/Recipe",
      "http://schema.org/Recipe",
    ].includes(type as string),
  );
}

/** Iterative traversal also handles WebPage.mainEntity without stack overflow. */
function collectNodes(parsed: any): any[] {
  const pending = [parsed];
  const nodes: any[] = [];
  while (pending.length > 0) {
    const node = pending.pop();
    if (!node || typeof node !== "object") continue;
    if (!Array.isArray(node)) nodes.push(node);
    const children = Array.isArray(node) ? node : Object.values(node);
    for (let i = children.length - 1; i >= 0; i--) {
      if (children[i] && typeof children[i] === "object")
        pending.push(children[i]);
    }
  }
  return nodes;
}

/** Preserve section headings and ordered steps rather than silently dropping sections. */
function instructionLines(value: any): string[] {
  const pending = [value];
  const lines: string[] = [];
  while (pending.length > 0) {
    const node = pending.pop();
    if (typeof node === "string") {
      if (node.trim()) lines.push(node.trim());
    } else if (Array.isArray(node)) {
      for (let i = node.length - 1; i >= 0; i--) pending.push(node[i]);
    } else if (node && typeof node === "object") {
      if (node.itemListElement) {
        if (typeof node.name === "string" && node.name.trim())
          lines.push(node.name.trim());
        pending.push(node.itemListElement);
      } else if (typeof node.text === "string") {
        pending.push(node.text);
      }
    }
  }
  return lines;
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
  /<script\b[^>]*\btype\s*=\s*["']application\/ld\+json(?:\s*;[^"']*)?["'][^>]*>([\s\S]*?)<\/script>/gi;

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

    const instructions = instructionLines(recipe.recipeInstructions);
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
  return parseVisibleRecipe(html);
}
