/**
 * Open Food Facts daily-delta refresh (M9). Keeps the seeded `foods` slice
 * fresh by applying OFF's published daily delta exports (NDJSON). See
 * DATA_SOURCING.md § 5. The orchestration takes injected I/O (list + fetch +
 * upsert) so the parse / filter / batching logic is unit-tested without the
 * network or gzip; the cron handler wires the real fetch + gunzip.
 */

import { mapOffBatch, type OffMapOptions, type OffFoodRow } from "./offMapper";

export type OffDeltaDeps = {
  /** Newest-last list of available delta filenames (from the delta index). */
  listDeltaFiles: () => Promise<string[]>;
  /** Decompressed NDJSON text for one delta file. */
  fetchDeltaNdjson: (filename: string) => Promise<string>;
  /** Idempotent bulk upsert (FoodRepository.upsertManyFromOff). */
  upsert: (rows: OffFoodRow[]) => Promise<number>;
  /** Process at most this many of the most-recent files (bound Lambda work). */
  maxFiles?: number;
  /** Upsert in batches of this size. */
  batchSize?: number;
  map?: OffMapOptions;
};

export type OffDeltaSummary = {
  files: number;
  parsed: number;
  mapped: number;
  upserted: number;
};

/** Parse one NDJSON blob into OFF products (skips blank / malformed lines). */
export function parseNdjson(text: string): unknown[] {
  const out: unknown[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed));
    } catch {
      // OFF delta files are one-object-per-line; a truncated tail line is
      // skipped rather than failing the whole refresh.
    }
  }
  return out;
}

export async function runOffDeltaRefresh(
  deps: OffDeltaDeps,
): Promise<OffDeltaSummary> {
  const maxFiles = deps.maxFiles ?? 1;
  const batchSize = deps.batchSize ?? 500;
  const summary: OffDeltaSummary = {
    files: 0,
    parsed: 0,
    mapped: 0,
    upserted: 0,
  };

  const all = await deps.listDeltaFiles();
  const recent = all.slice(-maxFiles);

  for (const filename of recent) {
    const ndjson = await deps.fetchDeltaNdjson(filename);
    const products = parseNdjson(ndjson);
    summary.files += 1;
    summary.parsed += products.length;

    const rows = mapOffBatch(products as never[], deps.map ?? {});
    summary.mapped += rows.length;

    for (let i = 0; i < rows.length; i += batchSize) {
      summary.upserted += await deps.upsert(rows.slice(i, i + batchSize));
    }
  }

  return summary;
}
