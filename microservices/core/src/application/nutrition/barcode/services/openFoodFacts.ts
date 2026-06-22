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

const OFF_BASE = "https://world.openfoodfacts.org/api/v2/product";
const OFF_FIELDS = "product_name,brands,nutriments,serving_size";
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
};

export type ResolveResult =
  | { found: true; food: ResolvedFood }
  | { found: false };

type OffNutriments = Record<string, number | string | undefined>;

function num(v: number | string | undefined): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Map an OFF product to our Food shape on a per-100g basis (serving_size=100,
 * unit=g). Returns null when the essential `energy-kcal_100g` is absent — we
 * can't persist a NOT NULL kcal, so treat it as "not found" and let the user
 * add the food manually.
 */
export function mapOffProduct(
  code: string,
  product: {
    product_name?: string;
    brands?: string;
    nutriments?: OffNutriments;
  },
): ResolvedFood | null {
  const n = product.nutriments ?? {};
  const kcal = num(n["energy-kcal_100g"]);
  if (kcal === null) return null;
  return {
    name: product.product_name?.trim() || "Unknown product",
    brand: product.brands?.split(",")[0]?.trim() || null,
    barcode: code,
    kcal,
    proteinG: num(n["proteins_100g"]) ?? 0,
    carbsG: num(n["carbohydrates_100g"]) ?? 0,
    fatG: num(n["fat_100g"]) ?? 0,
    servingSize: 100,
    servingUnit: "g",
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

  const body = (await res.json()) as {
    status?: number;
    product?: {
      product_name?: string;
      brands?: string;
      nutriments?: OffNutriments;
    };
  };

  if (body.status !== 1 || !body.product) return { found: false };

  const food = mapOffProduct(code, body.product);
  return food ? { found: true, food } : { found: false };
}
