-- Mealprint (spec-26) Phase 0 — `foods` tag enrichment (design § 2.1, AC 2.1).
--
-- Three tag arrays sourced from Open Food Facts, projected through the existing
-- seed/delta ETL (`offMapper.ts` → `FoodRepository.upsertManyFromOff`):
--
--   allergen_tags  — OFF `allergens_tags`   ('en:milk', 'en:gluten', …)
--   category_tags  — OFF `categories_tags`  (shopping-list grouping + pattern rules)
--   locale_tags    — OFF `countries_tags`   ('en:united-kingdom', …)
--
-- ⚠ **NULL MEANS UNKNOWN, AND UNKNOWN IS NEVER SAFE.** These columns are
-- nullable by design and `avoidanceFilter` treats a NULL `allergen_tags` as
-- "this row's allergen content is not known", which EXCLUDES it from any
-- allergen-filtered candidate pool (AC 2.2). That is the safe direction — a
-- user-created or AI-recognised food has no OFF tags and must not be offered to
-- someone avoiding peanuts on the strength of its name alone.
--
-- ⚠ **This migration leaves EVERY existing row NULL, and that is a visible
-- product state, not a silent one.** The OFF seed has already run: there are
-- ~144k `source = 'openfoodfacts'` rows in production, and until the re-seed
-- described below completes, all of them are "unknown allergens" and therefore
-- absent from allergen-filtered suggestions. A user with an allergen chip set
-- would see a thin or empty candidate pool. The backfill is a RE-SEED, not an
-- in-place UPDATE — the tags only exist in the OFF dump, not in our rows — so it
-- is an operational step:
--
--     duckdb -c "COPY ( SELECT code, product_name, brands, countries_tags,
--                              allergens_tags, categories_tags, ingredients_text,
--                              nutriments,
--                              TRY_CAST(serving_quantity AS DOUBLE) AS serving_quantity
--                       FROM 'food.parquet'
--                       WHERE code IS NOT NULL
--                         AND nutriments->>'energy-kcal_100g' IS NOT NULL
--                         AND list_contains(countries_tags, 'en:united-kingdom')
--                     ) TO 'off-uk.jsonl' (FORMAT JSON);"
--     DATABASE_URL=… bun run microservices/core/src/scripts/seedOpenFoodFacts.ts off-uk.jsonl
--
-- ⚠ `ingredients_text` is in that SELECT and is NEVER STORED. It is the only way
-- to tell "OFF analysed the ingredient list and found no allergen" (→ `[]`, a
-- usable claim) from "nobody ever entered ingredients" (→ NULL, unknown). Drop it
-- from the projection and every row becomes NULL, i.e. permanently excluded from
-- allergen-filtered pools — see `offMapper.mapOffAllergenTags`.
--
-- The upsert conflict-targets the partial unique index on `barcode`, so the
-- re-seed refreshes the existing catalogue rows in place and never touches a
-- private user food. Same hazard, same remedy as
-- `20260714120000_foods_serving_quantity.sql`, which also needed a re-seed to
-- populate a new column on already-seeded rows.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS. Additive
-- only, so the migrate-then-deploy order in `production-deploy.yml` is safe.
--
-- ⚠ **DO NOT HAND-APPLY THIS.** `production-deploy.yml` runs
-- `supabase db push --linked` (after a `--dry-run`) on `release: published`, and
-- it migrates BEFORE `sst deploy`; staging auto-applies on merge to `main`. An
-- earlier draft of this header said the production apply was manual — it is not,
-- and hand-applying would leave `supabase_migrations` out of step with the
-- release, which is worse than either doing nothing or letting the pipeline run.

ALTER TABLE foods
  ADD COLUMN IF NOT EXISTS allergen_tags text[];

ALTER TABLE foods
  ADD COLUMN IF NOT EXISTS category_tags text[];

ALTER TABLE foods
  ADD COLUMN IF NOT EXISTS locale_tags text[];

-- GIN indexes back the candidate-pool query's array containment/overlap
-- predicates (`locale_tags && ARRAY['en:united-kingdom']`, `NOT (allergen_tags
-- && ARRAY[…])`). Without them the pool query is a full scan of ~144k rows on
-- every suggestion, inside a request that already spends seconds in Bedrock.
--
-- ⚠ NOT `CONCURRENTLY`. `supabase db push` runs each migration file inside a
-- transaction and CREATE INDEX CONCURRENTLY cannot run in one. The columns are
-- entirely NULL at apply time, so the index build is near-instant regardless —
-- the write lock is measured in milliseconds, not the minutes a populated
-- 144k-row build would take. If these ever need rebuilding AFTER the re-seed,
-- do it by hand with CONCURRENTLY, outside a migration.
CREATE INDEX IF NOT EXISTS foods_allergen_tags_gin
  ON foods USING gin (allergen_tags);

CREATE INDEX IF NOT EXISTS foods_category_tags_gin
  ON foods USING gin (category_tags);

CREATE INDEX IF NOT EXISTS foods_locale_tags_gin
  ON foods USING gin (locale_tags);

COMMENT ON COLUMN foods.allergen_tags IS 'Mealprint (spec-26): OFF allergens_tags, normalised ("en:milk"). NULL = UNKNOWN, which avoidanceFilter treats as unsafe — an untagged row never passes an allergen filter (AC 2.2).';
COMMENT ON COLUMN foods.category_tags IS 'Mealprint (spec-26): OFF categories_tags. Drives dietary-pattern rules and shopping-list grouping. NULL = unknown.';
COMMENT ON COLUMN foods.locale_tags IS 'Mealprint (spec-26): OFF countries_tags. The candidate pool draws only locale-curated rows (AC 7.3). NULL = unknown, excluded from locale-filtered pools.';
