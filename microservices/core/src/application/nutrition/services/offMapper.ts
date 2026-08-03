/**
 * Open Food Facts product → our `foods` row mapper (M9 seed + delta refresh).
 * Pure + deterministic so the bulk-ingest filter logic is fully unit-tested
 * without DuckDB / the network. See DATA_SOURCING.md § 5.
 *
 * Macros are stored on a per-100g basis (serving_size=100, unit='g') — the
 * basis OFF's `*_100g` nutriments use. `source = 'openfoodfacts'` keeps OFF
 * rows segregable for the ODbL on-request offer.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { kcalFromOffNutriments } from "./offEnergy";

export type OffProduct = {
  code?: string;
  product_name?: string;
  brands?: string;
  countries_tags?: string[];
  nutriments?: Record<string, unknown>;
  serving_quantity?: number | string;
  // ── Mealprint (spec-26 § 2.1) ──────────────────────────────────────────────
  /** OFF `allergens_tags` — taxonomy-canonicalised where recognised ('en:milk'). */
  allergens_tags?: string[];
  /** OFF `categories_tags` — shopping-list grouping + dietary-pattern rules. */
  categories_tags?: string[];
  /**
   * OFF `ingredients_text`. NOT stored — read ONLY to decide whether an EMPTY
   * `allergens_tags` means "analysed, none found" or "never analysed". See
   * {@link mapOffAllergenTags}.
   */
  ingredients_text?: string;
};

export type OffFoodRow = {
  barcode: string;
  name: string;
  brand: string | null;
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  servingSize: number;
  servingUnit: string;
  /** Real pack serving (grams) from OFF `serving_quantity`; null when absent. */
  servingQuantity: number | null;
  /**
   * Mealprint (spec-26 § 2.1). `null` = UNKNOWN, which `avoidanceFilter` treats
   * as unsafe. `[]` = OFF analysed an ingredient list and found none of the
   * taxonomy allergens — a real, weaker-but-usable claim. See
   * {@link mapOffAllergenTags} for why those two cases must not be conflated.
   */
  allergenTags: string[] | null;
  categoryTags: string[] | null;
  localeTags: string[] | null;
  source: "openfoodfacts";
};

export type OffMapOptions = {
  /**
   * If set, the product must carry at least one of these `countries_tags`
   * (e.g. `en:united-kingdom`) to be accepted — the curated-locale filter.
   * Omitted → no locale filter.
   */
  countriesAllow?: string[];
};

function finiteNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/**
 * Normalise one OFF tag array: trim, lowercase, drop empties, dedupe, preserve
 * order. Returns `null` for an absent/empty input so "no tags" round-trips as
 * SQL NULL (= unknown) rather than as an empty array.
 *
 * Tags are stored RAW rather than filtered to the `en:` taxonomy prefix. That is
 * deliberate layering: dropping a `fr:lait` here would silently destroy the only
 * evidence that a product contains milk, and this module has no business making
 * a safety call. `avoidanceFilter` owns that decision and refuses any row
 * carrying a tag it cannot interpret.
 */
export function normaliseOffTags(
  tags: string[] | undefined | null,
): string[] | null {
  if (!Array.isArray(tags)) return null;
  const seen = new Set<string>();
  for (const tag of tags) {
    if (typeof tag !== "string") continue;
    const normalised = tag.trim().toLowerCase();
    if (normalised === "") continue;
    seen.add(normalised);
  }
  return seen.size > 0 ? [...seen] : null;
}

/**
 * Allergen tags, with the one judgement call in this file.
 *
 * ⚠ **An empty `allergens_tags` is ambiguous in OFF and the two readings are
 * safety-opposite.** OFF derives `allergens_tags` from the ingredient list, so:
 *
 *   - ingredients present + no allergen tags → "the ingredient list was analysed
 *     and none of the 14 regulated allergens appear in it". Weak (producer text
 *     can be wrong, cross-contamination is invisible) but a real signal, and the
 *     mandatory label-check disclaimer (AC 1.2) covers the residual.
 *   - **no ingredients at all** + no allergen tags → nobody ever entered
 *     ingredient data. This says NOTHING about the product, and the vast
 *     majority of thin OFF rows look like this.
 *
 * Collapsing both to `[]` would make every un-analysed row read as
 * "allergen-free" and would hand a peanut-avoiding user products nobody has
 * examined — precisely the failure the JAMA-cited review found in ~78 % of free
 * nutrition apps (requirements § Market context). So the second case maps to
 * `null` = unknown, and `avoidanceFilter` excludes it.
 *
 * The cost is real and worth stating: it shrinks the allergen-filtered pool to
 * rows with ingredient data. That is the correct direction to be wrong in, and
 * it improves for free as OFF's coverage does.
 */
export function mapOffAllergenTags(product: OffProduct): string[] | null {
  const tags = normaliseOffTags(product.allergens_tags);
  if (tags !== null) return tags;

  // No tags. Distinguish "analysed, clean" from "never analysed".
  const hasIngredientData =
    typeof product.ingredients_text === "string" &&
    product.ingredients_text.trim() !== "";
  return hasIngredientData ? [] : null;
}

/**
 * Map + FILTER one OFF product. Returns null (skip) unless it has: a barcode,
 * a name, complete per-100g macros (kcal/protein/carbs/fat all numeric and
 * non-negative), and — when `countriesAllow` is set — a matching locale.
 */
export function mapOffProductToFood(
  product: OffProduct,
  opts: OffMapOptions = {},
): OffFoodRow | null {
  const barcode = product.code?.trim();
  if (!barcode) return null;

  const name = product.product_name?.trim();
  if (!name) return null;

  if (opts.countriesAllow && opts.countriesAllow.length > 0) {
    const tags = product.countries_tags ?? [];
    if (!tags.some((t) => opts.countriesAllow!.includes(t))) return null;
  }

  const n = product.nutriments ?? {};
  // kcal with a kJ→kcal fallback so kJ-only products aren't dropped from the
  // seed (mirrors the live resolver).
  const kcal = kcalFromOffNutriments(n as Record<string, unknown>);
  const proteinG = finiteNumber((n as any)["proteins_100g"]);
  const carbsG = finiteNumber((n as any)["carbohydrates_100g"]);
  const fatG = finiteNumber((n as any)["fat_100g"]);
  if (kcal === null || proteinG === null || carbsG === null || fatG === null) {
    return null;
  }
  if (kcal < 0 || proteinG < 0 || carbsG < 0 || fatG < 0) return null;

  // Real pack serving (grams). Only a positive value is meaningful.
  const sq = finiteNumber(product.serving_quantity);

  return {
    barcode,
    name,
    brand: product.brands?.trim() || null,
    kcal,
    proteinG,
    carbsG,
    fatG,
    servingSize: 100,
    servingUnit: "g",
    servingQuantity: sq !== null && sq > 0 ? sq : null,
    allergenTags: mapOffAllergenTags(product),
    categoryTags: normaliseOffTags(product.categories_tags),
    // Reuses the SAME array the `countriesAllow` filter above reads, so a row
    // that passed the locale filter always carries the tag that let it through.
    localeTags: normaliseOffTags(product.countries_tags),
    source: "openfoodfacts",
  };
}

/** Map a batch, dropping the rows that don't pass the filter. */
export function mapOffBatch(
  products: OffProduct[],
  opts: OffMapOptions = {},
): OffFoodRow[] {
  return products
    .map((p) => mapOffProductToFood(p, opts))
    .filter((r): r is OffFoodRow => r !== null);
}
