#!/usr/bin/env bash
#
# Refresh the committed Open Food Facts UK dataset (packages/seed/data/off-uk.jsonl.gz)
# from the current Open Food Facts parquet dump. This does NOT touch the database —
# it only rebuilds the committed seed file. Run `bun run seed:foods` afterwards to load it.
#
#   bun run refresh:foods
#
# Requires: duckdb CLI (brew install duckdb) and ~10 GB free disk (the dump is ~7.6 GB).
#
# IMPORTANT — current HF dump schema:
#   nutriments   = STRUCT(name VARCHAR, value FLOAT, "100g" FLOAT, ...)[]   (a LIST)
#   product_name = STRUCT(lang VARCHAR, "text" VARCHAR)[]                    (multilingual LIST)
# The query below reshapes both into the { code, product_name, brands,
# countries_tags, nutriments:{energy-kcal_100g,...} } shape the offMapper expects,
# and dedupes on barcode (the prod unique index is partial on barcode) keeping the
# row with the most complete macros — a single upsert batch can't touch the same
# conflict target twice.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"      # packages/seed/src
DATA="$HERE/../data"
PARQUET_URL="https://huggingface.co/datasets/openfoodfacts/product-database/resolve/main/food.parquet"

WORK="$(mktemp -d -t off-refresh.XXXXXX)"
trap 'rm -rf "$WORK"' EXIT
cd "$WORK"

echo "[refresh:foods] downloading food.parquet (~7.6 GB)…"
curl -L --fail -o food.parquet "$PARQUET_URL"

echo "[refresh:foods] filtering to UK slice…"
duckdb -c "
COPY (
  SELECT
    code,
    coalesce(
      list_extract(list_transform(list_filter(product_name, p -> p.lang = lang AND trim(coalesce(p['text'],'')) <> ''), p -> p['text']), 1),
      list_extract(list_transform(list_filter(product_name, p -> p.lang = 'en'  AND trim(coalesce(p['text'],'')) <> ''), p -> p['text']), 1),
      list_extract(list_transform(list_filter(product_name, p -> trim(coalesce(p['text'],'')) <> ''),                    p -> p['text']), 1)
    ) AS product_name,
    brands,
    countries_tags,
    -- Real pack serving (grams) → offMapper reads top-level `serving_quantity`
    -- (positive → value, else NULL). Without this the seed lands serving_quantity
    -- NULL and the mobile Serving tab falls back to servingSize=100g. Cast to
    -- DOUBLE so a VARCHAR/absent column is tolerated (finiteNumber() coerces).
    TRY_CAST(serving_quantity AS DOUBLE) AS serving_quantity,
    map(
      ['energy-kcal_100g','proteins_100g','carbohydrates_100g','fat_100g'],
      [ list_extract(list_transform(list_filter(nutriments, x -> x.name = 'energy-kcal'),   x -> x['100g']), 1),
        list_extract(list_transform(list_filter(nutriments, x -> x.name = 'proteins'),      x -> x['100g']), 1),
        list_extract(list_transform(list_filter(nutriments, x -> x.name = 'carbohydrates'), x -> x['100g']), 1),
        list_extract(list_transform(list_filter(nutriments, x -> x.name = 'fat'),           x -> x['100g']), 1) ]
    ) AS nutriments
  FROM read_parquet('food.parquet')
  WHERE code IS NOT NULL
    AND list_contains(countries_tags, 'en:united-kingdom')
    AND list_extract(list_transform(list_filter(nutriments, x -> x.name = 'energy-kcal'), x -> x['100g']), 1) IS NOT NULL
  QUALIFY row_number() OVER (
    PARTITION BY trim(code)
    ORDER BY ( (list_extract(list_transform(list_filter(nutriments, x -> x.name = 'proteins'),      x -> x['100g']), 1) IS NOT NULL)::int
             + (list_extract(list_transform(list_filter(nutriments, x -> x.name = 'carbohydrates'), x -> x['100g']), 1) IS NOT NULL)::int
             + (list_extract(list_transform(list_filter(nutriments, x -> x.name = 'fat'),           x -> x['100g']), 1) IS NOT NULL)::int ) DESC
  ) = 1
) TO 'off-uk.jsonl' (FORMAT JSON);
"
echo "[refresh:foods] rows: $(wc -l < off-uk.jsonl)"
gzip -c off-uk.jsonl > "$DATA/off-uk.jsonl.gz"
echo "[refresh:foods] wrote $DATA/off-uk.jsonl.gz — commit it, then run: bun run seed:foods"
