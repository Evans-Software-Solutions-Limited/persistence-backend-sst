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

export type OffProduct = {
  code?: string;
  product_name?: string;
  brands?: string;
  countries_tags?: string[];
  nutriments?: Record<string, unknown>;
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
  const kcal = finiteNumber((n as any)["energy-kcal_100g"]);
  const proteinG = finiteNumber((n as any)["proteins_100g"]);
  const carbsG = finiteNumber((n as any)["carbohydrates_100g"]);
  const fatG = finiteNumber((n as any)["fat_100g"]);
  if (kcal === null || proteinG === null || carbsG === null || fatG === null) {
    return null;
  }
  if (kcal < 0 || proteinG < 0 || carbsG < 0 || fatG < 0) return null;

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
