/**
 * One-shot Open Food Facts seed (M9, 13-nutrition-tracking; DATA_SOURCING.md
 * § 5). Bulk-loads a CURATED subset of OFF into `foods` so common barcodes
 * resolve locally (offline + no live-API rate limit) from day 1.
 *
 * This is OPERATIONAL tooling — run once on a machine with the OFF dump, NOT in
 * a Lambda. The heavy filtering is done by DuckDB against the OFF Parquet dump;
 * this script is the thin glue that maps the filtered NDJSON to `foods` rows
 * (via the unit-tested offMapper) and upserts them idempotently in batches.
 *
 * Usage:
 *   1. Download the OFF Parquet dump (https://world.openfoodfacts.org/data).
 *   2. Filter to the curated slice with DuckDB, e.g.:
 *        duckdb -c "COPY (
 *          SELECT code, product_name, brands, countries_tags, nutriments,
 *                 TRY_CAST(serving_quantity AS DOUBLE) AS serving_quantity
 *          FROM 'food.parquet'
 *          WHERE code IS NOT NULL
 *            AND nutriments->>'energy-kcal_100g' IS NOT NULL
 *            AND list_contains(countries_tags, 'en:united-kingdom')
 *        ) TO 'off-uk.jsonl' (FORMAT JSON);"
 *   3. DATABASE_URL=... bun run microservices/core/src/scripts/seedOpenFoodFacts.ts off-uk.jsonl
 *
 * Idempotent: re-running refreshes existing rows (upsert on barcode).
 */

import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import {
  mapOffProductToFood,
  type OffFoodRow,
} from "../application/nutrition/services/offMapper";
import { FoodRepository } from "../application/repositories/foodRepository";

const BATCH_SIZE = 500;

async function main(): Promise<void> {
  const path = process.argv[2];
  if (!path) {
    console.error(
      "usage: bun run seedOpenFoodFacts.ts <off-products.jsonl>\n" +
        "(produce the NDJSON via a DuckDB query over the OFF Parquet dump — see file header)",
    );
    process.exit(1);
  }

  const repo = new FoodRepository();
  const rl = createInterface({
    input: createReadStream(path, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  let read = 0;
  let mapped = 0;
  let upserted = 0;
  let batch: OffFoodRow[] = [];

  const flush = async (): Promise<void> => {
    if (batch.length === 0) return;
    upserted += await repo.upsertManyFromOff(batch);
    batch = [];
  };

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    read += 1;
    let product: unknown;
    try {
      product = JSON.parse(trimmed);
    } catch {
      continue; // skip malformed lines
    }
    const row = mapOffProductToFood(product as never);
    if (!row) continue;
    mapped += 1;
    batch.push(row);
    if (batch.length >= BATCH_SIZE) await flush();
  }
  await flush();

  console.log(
    `[off-seed] done — read=${read} mapped=${mapped} upserted=${upserted}`,
  );
  // postgres.js holds the connection open and keeps the event loop alive;
  // exit explicitly so the script (and `seed:foods`) terminates cleanly.
  process.exit(0);
}

main().catch((err) => {
  console.error("[off-seed] failed", err);
  process.exit(1);
});
