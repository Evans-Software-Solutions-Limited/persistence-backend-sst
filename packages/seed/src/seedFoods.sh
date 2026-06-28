#!/usr/bin/env bash
#
# Foods (Open Food Facts UK) seed. Reuses the tested seedOpenFoodFacts.ts loader
# (offMapper + idempotent upsert) against the committed, pre-deduped NDJSON.
#
#   DATABASE_URL='<supabase pooled prod URI>' bun run seed:foods
#
# The dataset is committed gzipped at packages/seed/data/off-uk.jsonl.gz (ODbL —
# see ../data/ATTRIBUTION-openfoodfacts.md). To refresh it from a newer OFF dump,
# run `bun run refresh:foods` (src/refreshOffDump.sh).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"      # packages/seed/src
ROOT="$(cd "$HERE/../../.." && pwd)"                       # repo root
GZ="$HERE/../data/off-uk.jsonl.gz"
TMP="$(mktemp -t off-uk.XXXXXX.jsonl)"
trap 'rm -f "$TMP"' EXIT

if [[ ! -f "$GZ" ]]; then
  echo "ERROR: $GZ not found. Refresh it with: bun run refresh:foods" >&2
  exit 1
fi

echo "[seed:foods] decompressing $(basename "$GZ")…"
gunzip -kc "$GZ" > "$TMP"
echo "[seed:foods] rows: $(wc -l < "$TMP")"

cd "$ROOT"
bun run microservices/core/src/scripts/seedOpenFoodFacts.ts "$TMP"
