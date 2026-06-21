-- M9 (13-nutrition-tracking) — Nutrition (Fuel) Tier-A schema block.
--
-- One additive migration carrying the whole M9 Tier-A schema surface per
-- specs/13-nutrition-tracking/design.md § Database schema and
-- specs/_shared/cross-cuts.md § 6.
--
-- Scope (FK-dependency order — Postgres has no forward-declared FKs, so a
-- table must exist before another REFERENCES it):
--   1. foods
--   2. recipes
--   3. recipe_ingredients   (-> recipes, foods)
--   4. meals
--   5. meal_items           (-> meals, foods, recipes)
--   6. nutrition_entries    (-> foods, recipes, meals)  incl. logged_by_user_id
--                            + ai_estimated/ai_confidence (built-in from day 1,
--                            unused until M8 / M9.5 per cross-cuts § 1.1)
--   7. nutrition_targets    incl. set_by_user_id (M8 trainer cross-cut writes it)
--   8. water_log
--   9. ai_usage_log         (contract stub — table created now, written in M9.5
--                            per cross-cuts § 4.2)
--
-- The daily_nutrition_target_hit notification_type enum value lands in a
-- SEPARATE migration (20260621120100_m9_notification_type_target_hit.sql) —
-- Postgres forbids using a newly added enum value in the same transaction
-- that adds it, so usage and ADD VALUE never share a migration.
--
-- nutrition_streak already exists in streak_type_enum (added M4-gated by
-- 20260607120100_m4_progress_schema.sql); no streak-enum change here.
--
-- Idempotent throughout: CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT
-- EXISTS. Forward/back safe — a rollback drops only net-new objects.

-- ─── 1. foods ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS foods (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  brand           text,
  barcode         text UNIQUE,
  kcal            numeric NOT NULL,
  protein_g       numeric NOT NULL,
  carbs_g         numeric NOT NULL,
  fat_g           numeric NOT NULL,
  serving_size    numeric NOT NULL,
  serving_unit    text NOT NULL,
  source          text NOT NULL DEFAULT 'user',  -- 'user' | 'openfoodfacts' | 'ai_recognized'
  created_by      uuid REFERENCES profiles(id),
  created_at      timestamptz DEFAULT now()
);

-- Barcode lookups (cache-first resolve path) + source-segregation for the
-- ODbL on-request offer of OFF-derived rows (DATA_SOURCING.md § 5).
CREATE INDEX IF NOT EXISTS foods_source_idx ON foods (source);

-- ─── 2. recipes ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS recipes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES profiles(id),
  name            text NOT NULL,
  photo_url       text,
  servings        numeric NOT NULL DEFAULT 1,
  instructions    text,
  source          text NOT NULL DEFAULT 'manual',  -- 'manual' | 'url_import' | 'ai_extracted'
  source_url      text,
  total_kcal      numeric,                          -- materialised from ingredients
  total_protein_g numeric,
  total_carbs_g   numeric,
  total_fat_g     numeric,
  created_at      timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS recipes_user_idx ON recipes (user_id);

-- ─── 3. recipe_ingredients ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS recipe_ingredients (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id     uuid NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  food_id       uuid REFERENCES foods(id),
  custom_name   text,                                -- when not linked to a food row
  quantity      numeric NOT NULL,
  unit          text NOT NULL,
  sort_order    integer NOT NULL
);
CREATE INDEX IF NOT EXISTS recipe_ingredients_recipe_idx ON recipe_ingredients (recipe_id);

-- ─── 4. meals ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS meals (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES profiles(id),
  name            text NOT NULL,
  photo_url       text,
  total_kcal      numeric NOT NULL,
  total_protein_g numeric NOT NULL,
  total_carbs_g   numeric NOT NULL,
  total_fat_g     numeric NOT NULL,
  created_at      timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS meals_user_idx ON meals (user_id);

-- ─── 5. meal_items ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS meal_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meal_id       uuid NOT NULL REFERENCES meals(id) ON DELETE CASCADE,
  food_id       uuid REFERENCES foods(id),
  recipe_id     uuid REFERENCES recipes(id),
  servings      numeric NOT NULL,
  sort_order    integer NOT NULL
);
CREATE INDEX IF NOT EXISTS meal_items_meal_idx ON meal_items (meal_id);

-- ─── 6. nutrition_entries ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS nutrition_entries (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES profiles(id),
  food_id           uuid REFERENCES foods(id),                    -- nullable if logging a custom one-off
  recipe_id         uuid REFERENCES recipes(id),                  -- nullable
  meal_id           uuid REFERENCES meals(id),                    -- nullable
  meal_slot         text NOT NULL CHECK (meal_slot IN ('breakfast','lunch','snack','dinner')),
  servings          numeric NOT NULL,
  kcal              numeric NOT NULL,                              -- denormalised for fast reads
  protein_g         numeric NOT NULL,
  carbs_g           numeric NOT NULL,
  fat_g             numeric NOT NULL,
  logged_at         timestamptz NOT NULL,
  logged_by_user_id uuid REFERENCES profiles(id),                 -- cross-cuts § 1.1 — M8 trainer-on-behalf
  ai_estimated      boolean NOT NULL DEFAULT false,
  ai_confidence     numeric                                       -- 0..1, populated when ai_estimated (M9.5)
);
CREATE INDEX IF NOT EXISTS nutrition_entries_user_date
  ON nutrition_entries (user_id, logged_at DESC);
CREATE INDEX IF NOT EXISTS nutrition_entries_user_slot_date
  ON nutrition_entries (user_id, meal_slot, logged_at DESC);

-- ─── 7. nutrition_targets ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS nutrition_targets (
  user_id           uuid PRIMARY KEY REFERENCES profiles(id),
  daily_kcal        numeric NOT NULL,
  protein_g         numeric NOT NULL,
  carbs_g           numeric NOT NULL,
  fat_g             numeric NOT NULL,
  water_cups        integer NOT NULL DEFAULT 8,
  preset            text DEFAULT 'custom',
  set_by_user_id    uuid REFERENCES profiles(id),                 -- cross-cuts § 1.5 — trainer attribution (M8 writes)
  updated_at        timestamptz DEFAULT now()
);

-- ─── 8. water_log ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS water_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES profiles(id),
  cups            integer NOT NULL,
  logged_date     date NOT NULL,
  UNIQUE (user_id, logged_date)
);

-- ─── 9. ai_usage_log (contract stub — cross-cuts § 4.2, written in M9.5) ─────
CREATE TABLE IF NOT EXISTS ai_usage_log (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES profiles(id),
  endpoint            text NOT NULL,
  request_size_bytes  integer,
  response_size_bytes integer,
  ms                  integer,
  created_at          timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_usage_log_user_ts ON ai_usage_log (user_id, created_at DESC);
