/**
 * Open Food Facts barcode resolver. See specs/milestones/M9-nutrition/
 * DATA_SOURCING.md § 2.
 *
 * OFF is free + keyless but rate-limited to 15 product reads/min/IP. Because a
 * Lambda concentrates every user's scans onto one egress IP, the durable
 * mitigation is the cache-first `foods` lookup + the curated OFF seed — NOT
 * retrying here. So this client makes ONE attempt with a mandatory custom
 * User-Agent and a bounded timeout; on 429 / 5xx / network error it raises
 * `OpenFoodFactsUnavailableError` (handler → 503) rather than retrying into an
 * IP ban. A genuine "no such product" (OFF status 0 / 404) resolves to
 * `{ found: false }` (handler → 404 barcode_not_found).
 */

import {
  resolveOffEnergy,
  type OffNutritionDataIssue,
} from "../../services/offEnergy";
import { mapOffAllergenTags, normaliseOffTags } from "../../services/offMapper";

const OFF_BASE = "https://world.openfoodfacts.org/api/v2/product";
// `serving_quantity` is the real per-serving size in grams (drives the scan
// sheet's Serving tab); `energy-kj_100g` backs the kJ→kcal fallback for
// kcal-less products and allows contradictory energy to be quarantined.
//
// ⚠ The four Mealprint fields (spec-26 § 2.1) are requested here as well as in
// the bulk seed, because this path also WRITES `foods` rows — a live barcode
// resolve is a cache fill. Omitting them would mean every food a user scanned
// landed with NULL tags, i.e. permanently excluded from allergen-filtered
// candidate pools, which is the shelf a scanning user is most likely to want
// back. `ingredients_text` is requested but never stored: it is the only way to
// tell "analysed, no allergens" from "never analysed" (see
// `offMapper.mapOffAllergenTags`).
const OFF_FIELDS =
  "product_name,brands,nutriments,serving_quantity,serving_size," +
  "allergens_tags,categories_tags,countries_tags,ingredients_text," +
  "data_quality_tags,data_quality_errors_tags,data_quality_warnings_tags";
const TIMEOUT_MS = 8000;
// ODbL + politeness: a descriptive UA is mandatory; a generic/missing one gets
// throttled or blocked by OFF.
const USER_AGENT = "Persistence/1.0 (apps@persistence.fit)";

export class OpenFoodFactsUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenFoodFactsUnavailableError";
    Object.setPrototypeOf(this, OpenFoodFactsUnavailableError.prototype);
  }
}

export type ResolvedFood = {
  name: string;
  brand: string | null;
  barcode: string;
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
   * as unsafe; `[]` = OFF analysed an ingredient list and found none of the 14
   * regulated allergens. Mapped by the SAME functions the bulk seed uses, so the
   * live and bulk paths cannot drift on a safety-relevant encoding.
   */
  allergenTags: string[] | null;
  categoryTags: string[] | null;
  localeTags: string[] | null;
  nutritionDataValid: boolean;
  nutritionDataIssue: OffNutritionDataIssue | null;
};

export type ResolveResult =
  | { found: true; food: ResolvedFood }
  | { found: false; invalidFood?: ResolvedFood };

type OffNutriments = Record<string, number | string | undefined>;

function num(v: number | string | undefined): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Map an OFF product to our Food shape. Macros are per-100g (serving_size=100,
 * unit=g); `serving_quantity` (the real pack serving, grams) is carried through
 * separately so the scan sheet's Serving tab can mean the real pack. Returns
 * null when NO energy figure is present (kcal or kJ)
 * — we can't persist a NOT NULL kcal, so treat it as "not found" and let the
 * user add the food manually.
 */
export function mapOffProduct(
  code: string,
  product: {
    product_name?: string;
    brands?: string;
    nutriments?: OffNutriments;
    serving_quantity?: number | string;
    allergens_tags?: string[];
    categories_tags?: string[];
    countries_tags?: string[];
    ingredients_text?: string;
    data_quality_tags?: string[];
    data_quality_errors_tags?: string[];
    data_quality_warnings_tags?: string[];
  },
): ResolvedFood | null {
  const n = product.nutriments ?? {};
  const proteinG = num(n["proteins_100g"]) ?? 0;
  const carbsG = num(n["carbohydrates_100g"]) ?? 0;
  const fatG = num(n["fat_100g"]) ?? 0;
  const energy = resolveOffEnergy(n, {
    proteinG,
    carbsG,
    fatG,
    qualityTags: [
      ...(product.data_quality_tags ?? []),
      ...(product.data_quality_errors_tags ?? []),
      ...(product.data_quality_warnings_tags ?? []),
    ],
  });
  if (energy.kcal === null) return null;
  const sq = num(product.serving_quantity);
  return {
    name: product.product_name?.trim() || "Unknown product",
    brand: product.brands?.split(",")[0]?.trim() || null,
    barcode: code,
    kcal: energy.kcal,
    proteinG,
    carbsG,
    fatG,
    servingSize: 100,
    servingUnit: "g",
    // Only a positive serving is meaningful; 0 / negative / absent → null.
    servingQuantity: sq !== null && sq > 0 ? sq : null,
    allergenTags: mapOffAllergenTags(product),
    categoryTags: normaliseOffTags(product.categories_tags),
    localeTags: normaliseOffTags(product.countries_tags),
    nutritionDataValid: energy.nutritionDataValid,
    nutritionDataIssue: energy.nutritionDataIssue,
  };
}

export async function resolveBarcodeFromOFF(
  code: string,
  deps: { fetcher?: typeof fetch } = {},
): Promise<ResolveResult> {
  const fetcher = deps.fetcher ?? fetch;
  let res: Response;
  try {
    res = await fetcher(
      `${OFF_BASE}/${encodeURIComponent(code)}.json?fields=${OFF_FIELDS}`,
      {
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );
  } catch (e) {
    // Timeout / DNS / network — do not retry (IP-ban risk), surface as 503.
    throw new OpenFoodFactsUnavailableError(
      `off_fetch_failed: ${(e as Error).message}`,
    );
  }

  if (res.status === 404) return { found: false };
  if (res.status === 429 || res.status >= 500) {
    throw new OpenFoodFactsUnavailableError(`off_status_${res.status}`);
  }
  if (!res.ok)
    throw new OpenFoodFactsUnavailableError(`off_status_${res.status}`);

  let body: {
    status?: number;
    product?: {
      product_name?: string;
      brands?: string;
      nutriments?: OffNutriments;
      serving_quantity?: number | string;
      allergens_tags?: string[];
      categories_tags?: string[];
      countries_tags?: string[];
      ingredients_text?: string;
      data_quality_tags?: string[];
      data_quality_errors_tags?: string[];
      data_quality_warnings_tags?: string[];
    };
  };
  try {
    // A 2xx with a non-JSON body (captive portal / proxy HTML / truncated
    // response) would otherwise throw a SyntaxError that escapes the handler's
    // `instanceof OpenFoodFactsUnavailableError` check → 500. Treat an
    // unparseable body as OFF being unavailable → 503. Review fix (PR #124).
    body = (await res.json()) as typeof body;
  } catch (e) {
    throw new OpenFoodFactsUnavailableError(
      `off_invalid_json: ${(e as Error).message}`,
    );
  }

  if (body.status !== 1 || !body.product) return { found: false };

  const food = mapOffProduct(code, body.product);
  if (!food) return { found: false };
  return food.nutritionDataValid
    ? { found: true, food }
    : { found: false, invalidFood: food };
}
