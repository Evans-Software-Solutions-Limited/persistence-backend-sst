import { gunzipSync } from "node:zlib";
import { runOffDeltaRefresh } from "./application/nutrition/services/offDelta";
import { FoodRepository } from "./application/repositories/foodRepository";

/**
 * Daily Open Food Facts delta-refresh — scheduled via `sst.aws.Cron` in
 * infra/api.ts (M9, 13-nutrition-tracking; DATA_SOURCING.md § 5). Applies OFF's
 * most-recent published daily delta (NDJSON, gzipped) to the seeded `foods`
 * slice so cached macros stay fresh without hitting the rate-limited live API.
 *
 * This is static published data (not the rate-limited product API), but we
 * still send the required custom User-Agent and stay polite. The orchestration
 * + mapping live in application/nutrition/services/offDelta.ts (unit-tested);
 * this handler is the impure fetch + gunzip edge.
 */

const DELTA_BASE = "https://static.openfoodfacts.org/data/delta";
const USER_AGENT = `Persistence/1.0 (${
  process.env.OFF_CONTACT_EMAIL ?? "apps@persistence.app"
})`;
const TIMEOUT_MS = 25_000;

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`off_delta_fetch_${res.status}`);
  return res.text();
}

export async function handler(): Promise<{
  files: number;
  parsed: number;
  mapped: number;
  upserted: number;
}> {
  const repo = new FoodRepository();

  const summary = await runOffDeltaRefresh({
    // index.txt is newline-separated filenames, oldest→newest.
    listDeltaFiles: async () =>
      (await fetchText(`${DELTA_BASE}/index.txt`))
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean),
    fetchDeltaNdjson: async (filename) => {
      const res = await fetch(`${DELTA_BASE}/${filename}`, {
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`off_delta_file_${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      // Delta files are gzipped JSONL (`*.jsonl.gz`).
      return gunzipSync(buf).toString("utf8");
    },
    upsert: (rows) => repo.upsertManyFromOff(rows),
    maxFiles: 1,
    // Curated locale — start UK; widen by editing this list (DATA_SOURCING § 5).
    map: { countriesAllow: ["en:united-kingdom"] },
  });

  console.log(`[off-delta-cron:summary] ${JSON.stringify(summary)}`);
  return summary;
}
