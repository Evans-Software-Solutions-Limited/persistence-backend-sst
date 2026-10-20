import { getStripe } from "../stripe/stripeClient";
import {
  ALL_BLC_LOOKUP_KEYS,
  BLC_CADENCES,
  BLC_PRICE_CURRENCY,
  BLC_PRICE_LOOKUP_KEYS,
  BLC_TIERS,
  type BlcCadence,
  type BlcTier,
} from "./blcOffer";

/**
 * Resolving the four BLC Prices from Stripe, by lookup key.
 *
 * Mirrors `founding/checkout/foundingPrices.ts`, and for the same reasons: a
 * lookup key is identical in test and live mode so `STRIPE_SECRET_KEY` stays
 * the only per-environment value; and a Price is only USED once its amount,
 * currency and billing interval match the catalogue in `blcOffer.ts`, so a key
 * re-pointed in the dashboard is refused rather than silently sold.
 *
 * One addition over the founding resolver: these are RECURRING Prices, so the
 * interval is checked too. A monthly key pointed at an annual Price would pass
 * an amount check only by coincidence; the interval check closes that.
 *
 * Fail closed: anything missing or mismatched throws `BlcPriceError`, which the
 * route turns into 503 `unavailable`. The buyer did nothing wrong.
 */

export class BlcPriceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlcPriceError";
  }
}

/** lookup key → verified Price id. Only ever a COMPLETE set. */
let cache: Map<string, string> | null = null;

/** True once the "not usable" line has been logged, so a warm container logs once. */
let warned = false;

export function __resetBlcPricesForTests(): void {
  cache = null;
  warned = false;
}

interface Expected {
  amountMinor: number;
  interval: "month" | "year";
}

function expectedByKey(): Map<string, Expected> {
  const out = new Map<string, Expected>();
  for (const tier of BLC_TIERS) {
    for (const cadence of BLC_CADENCES) {
      const entry = BLC_PRICE_LOOKUP_KEYS[tier][cadence];
      out.set(entry.lookupKey, {
        amountMinor: entry.amountMinor,
        interval: entry.interval,
      });
    }
  }
  return out;
}

async function loadPrices(): Promise<Map<string, string> | null> {
  let page;
  try {
    page = await getStripe().prices.list({
      lookup_keys: ALL_BLC_LOOKUP_KEYS,
      active: true,
      limit: ALL_BLC_LOOKUP_KEYS.length,
    });
  } catch (err) {
    console.error(
      `[blc:prices] could not list prices: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return null;
  }

  const expected = expectedByKey();
  const byKey = new Map<string, string>();
  for (const price of page.data) {
    const key = price.lookup_key;
    if (key === null || key === undefined) continue;
    const wanted = expected.get(key);
    if (wanted === undefined) continue;
    if (price.unit_amount !== wanted.amountMinor) {
      console.error(
        `[blc:prices] ${key} is ${price.unit_amount} minor units, expected ${wanted.amountMinor} — refusing it`,
      );
      continue;
    }
    if (price.currency !== BLC_PRICE_CURRENCY) {
      console.error(
        `[blc:prices] ${key} is in ${price.currency}, expected ${BLC_PRICE_CURRENCY} — refusing it`,
      );
      continue;
    }
    if (price.recurring?.interval !== wanted.interval) {
      console.error(
        `[blc:prices] ${key} recurs every ${price.recurring?.interval ?? "never"}, expected ${wanted.interval} — refusing it`,
      );
      continue;
    }
    byKey.set(key, price.id);
  }

  const missing = ALL_BLC_LOOKUP_KEYS.filter((k) => !byKey.has(k));
  if (missing.length > 0) {
    if (!warned) {
      warned = true;
      console.error(
        `[blc:prices] not usable — missing or mismatched: ${missing.join(", ")}`,
      );
    }
    // Not cached: a key created a minute from now should work without a
    // redeploy, and a half-set must never be treated as good.
    return null;
  }

  warned = false;
  return byKey;
}

/**
 * The verified Stripe Price id for one tier × cadence. Resolves the whole set
 * on first use and reuses it for the life of the container; a miss re-reads
 * from Stripe rather than staying broken until the container recycles.
 */
export async function resolveBlcPrice(
  tier: BlcTier,
  cadence: BlcCadence,
): Promise<string> {
  const { lookupKey } = BLC_PRICE_LOOKUP_KEYS[tier][cadence];
  const cached = cache?.get(lookupKey);
  if (cached) return cached;

  const loaded = await loadPrices();
  if (loaded === null) {
    throw new BlcPriceError("BLC prices could not be verified");
  }
  cache = loaded;
  // `loadPrices` only ever returns a COMPLETE set, so every catalogue key is
  // present here.
  return loaded.get(lookupKey)!;
}
