import { getStripe } from "../../stripe/stripeClient";
import {
  ALL_FOUNDING_LOOKUP_KEYS,
  FOUNDING_PRICE_CURRENCY,
  FOUNDING_PRICE_LOOKUP_KEYS,
  type FoundingWebMonths,
  type FoundingWebTier,
} from "../foundingOffer";

/**
 * Resolving the four founding Prices from Stripe, by lookup key.
 *
 * ─── Why lookup keys and not ids ───
 *
 * A Price id differs between test and live mode; a lookup key does not. Using
 * keys means `STRIPE_SECRET_KEY` is the only per-environment value in the
 * whole rail — there is nothing to configure per stage, and therefore no way
 * for staging to be pointed at a live Price by a copy-paste slip.
 *
 * ─── Why the amount is verified ───
 *
 * The Price is still the authority on what a buyer is charged, and this file
 * never overrides it. What it does is REFUSE a Price that does not match the
 * offer we advertise. Stripe's dashboard makes it easy to attach a lookup key
 * to a different Price; without this check, doing so would silently change
 * what `/founding` sells while the page went on displaying the old figure.
 *
 * ─── Fail closed ───
 *
 * A missing key, a wrong amount, a wrong currency, or Stripe being
 * unreachable all produce the same answer: no price, and the route answers
 * 503. Creating a Checkout Session with a Price we could not verify is the one
 * outcome worth avoiding at any cost — it charges somebody the wrong amount.
 */

export type PriceResolution =
  | { ok: true; priceId: string }
  | { ok: false; reason: FoundingPriceError };

export type FoundingPriceError =
  | "unavailable"
  | "missing_price"
  | "price_mismatch";

interface CachedPrices {
  /** lookup key → Price id, only for keys that verified cleanly. */
  byKey: Map<string, string>;
}

/**
 * Memoised for the life of the process (a warm Lambda container).
 *
 * Prices essentially never change, and a `prices.list` call on every checkout
 * would add a Stripe round trip to the one request where latency is most
 * visible. The cache is only ever populated with a COMPLETE, fully verified
 * set, so a partial or failed resolution is never cached — the next request
 * retries rather than inheriting a bad answer.
 */
let cache: CachedPrices | null = null;

/** True once the "prices are not configured" line has been logged. */
let warned = false;

export function __resetFoundingPricesForTests(): void {
  cache = null;
  warned = false;
}

async function loadPrices(): Promise<CachedPrices | null> {
  let page;
  try {
    page = await getStripe().prices.list({
      lookup_keys: ALL_FOUNDING_LOOKUP_KEYS,
      active: true,
      limit: ALL_FOUNDING_LOOKUP_KEYS.length,
    });
  } catch (err) {
    console.error(
      `[founding:prices] could not list prices: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return null;
  }

  const expected = new Map(
    Object.values(FOUNDING_PRICE_LOOKUP_KEYS).flatMap((byTerm) =>
      Object.values(byTerm).map(
        (entry) => [entry.lookupKey, entry.amountMinor] as const,
      ),
    ),
  );

  const byKey = new Map<string, string>();
  for (const price of page.data) {
    const key = price.lookup_key;
    if (key === null || key === undefined) continue;
    const wanted = expected.get(key);
    if (wanted === undefined) continue;
    // The guard. A lookup key re-pointed at a different Price in the dashboard
    // would otherwise change what this page charges with no code change and no
    // warning.
    if (price.unit_amount !== wanted) {
      console.error(
        `[founding:prices] ${key} is ${price.unit_amount} minor units, expected ${wanted} — refusing it`,
      );
      continue;
    }
    if (price.currency !== FOUNDING_PRICE_CURRENCY) {
      console.error(
        `[founding:prices] ${key} is in ${price.currency}, expected ${FOUNDING_PRICE_CURRENCY} — refusing it`,
      );
      continue;
    }
    byKey.set(key, price.id);
  }

  const missing = ALL_FOUNDING_LOOKUP_KEYS.filter((k) => !byKey.has(k));
  if (missing.length > 0) {
    if (!warned) {
      warned = true;
      console.error(
        `[founding:prices] not usable — missing or mismatched: ${missing.join(", ")}`,
      );
    }
    // Deliberately NOT cached: a key created a minute from now should work
    // without a redeploy, and a half-set must never be treated as good.
    return null;
  }

  warned = false;
  return { byKey };
}

/**
 * The verified Stripe Price id for one term.
 *
 * Resolves the whole set on first use and reuses it; a miss (or a previously
 * failed resolution) re-reads from Stripe rather than staying broken until the
 * container recycles.
 */
export async function resolveFoundingPrice(
  tier: FoundingWebTier,
  months: FoundingWebMonths,
): Promise<PriceResolution> {
  const { lookupKey } = FOUNDING_PRICE_LOOKUP_KEYS[tier][months];

  if (cache?.byKey.has(lookupKey)) {
    return { ok: true, priceId: cache.byKey.get(lookupKey)! };
  }

  const loaded = await loadPrices();
  if (loaded === null) return { ok: false, reason: "unavailable" };
  cache = loaded;

  const priceId = loaded.byKey.get(lookupKey);
  return priceId
    ? { ok: true, priceId }
    : { ok: false, reason: "missing_price" };
}
