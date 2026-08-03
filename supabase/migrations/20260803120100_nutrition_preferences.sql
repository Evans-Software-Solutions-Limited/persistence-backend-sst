-- Mealprint (spec-26) Phase 0 — `nutrition_preferences` +
-- `mealprint_ingredient_feedback` (design § 2.2; AC 1.3, 7.2).
--
-- `nutrition_preferences` is ONE ROW PER USER, keyed on user_id, with upsert
-- semantics exactly like `nutrition_targets` — the surface is "edit my food
-- preferences", never "add a preferences record", so a surrogate id would only
-- create the possibility of two.
--
-- Every array is NOT NULL DEFAULT '{}' rather than nullable. A nullable array
-- would give two encodings of "no avoidances" (NULL and '{}') and every read
-- path would have to coalesce; more importantly, `avoidanceFilter` branches on
-- emptiness and a null slipping through would read as "no filter" — the unsafe
-- direction for a column whose whole job is exclusion.
--
-- ⚠ The vocabularies are enforced with CHECK constraints AND in
-- `NutritionPreferenceRepository`. That duplication is deliberate: the handler
-- check produces a 400 with the offending value named, which is the useful
-- error; the DB constraint is the backstop that means a future write path
-- (a coach-on-behalf route, a data fix) cannot store a pattern string the
-- filter has no rule for. A pattern the filter does not recognise would be
-- SILENTLY IGNORED at generation time — i.e. a user who selected "vegan" gets
-- meat — which is the failure mode both layers exist to prevent.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS; the CHECKs are inline so they arrive
-- with the table and a re-run is a no-op.

CREATE TABLE IF NOT EXISTS nutrition_preferences (
  user_id          uuid PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,

  -- Multi-select over the compatible subset (AC 1.1) — 'vegetarian' +
  -- 'gluten_free' is a legitimate pair, so this is an array and not a single
  -- column. Values must match `DIETARY_PATTERNS` in
  -- `mealprint/preferences/vocabulary.ts`.
  dietary_patterns text[] NOT NULL DEFAULT '{}'
    CONSTRAINT nutrition_preferences_patterns_known CHECK (
      dietary_patterns <@ ARRAY[
        'vegetarian', 'vegan', 'pescatarian', 'halal', 'kosher',
        'dairy_free', 'gluten_free'
      ]::text[]
    ),

  -- Allergen-grade avoidances from the fixed UK FIC-14-derived vocabulary
  -- (Brad signed off the chip set 2026-07-24). These map to `foods.allergen_tags`
  -- by TAG, not by name, and an untagged food never passes.
  avoid_allergens  text[] NOT NULL DEFAULT '{}'
    CONSTRAINT nutrition_preferences_allergens_known CHECK (
      avoid_allergens <@ ARRAY[
        'celery', 'gluten', 'crustaceans', 'eggs', 'fish', 'lupin', 'milk',
        'molluscs', 'mustard', 'nuts', 'peanuts', 'sesame', 'soybeans',
        'sulphites'
      ]::text[]
    ),

  -- Free-text dislikes ("mushrooms", "olives"), normalised on write (lowercased,
  -- trimmed, accent-stripped) so name matching is a comparison and not a
  -- guess. STORY-007's "hard to find near me" appends here with a
  -- `hardtofind:` prefix — a convention kept out of UI copy.
  avoid_foods      text[] NOT NULL DEFAULT '{}',

  -- Bias, never a constraint: liked foods are FLAGGED to the model, so an empty
  -- pool is never caused by likes.
  liked_foods      text[] NOT NULL DEFAULT '{}',

  meals_per_day    integer NOT NULL DEFAULT 4
    CONSTRAINT nutrition_preferences_meals_range CHECK (meals_per_day BETWEEN 2 AND 6),

  effort_level     text NOT NULL DEFAULT 'balanced'
    CONSTRAINT nutrition_preferences_effort_known CHECK (
      effort_level IN ('quick', 'balanced', 'high_maintenance')
    ),

  -- v1 ships en-GB only (locked decision 5) but the preference is stored from
  -- day 1 so adding a locale is a catalogue job, not a migration.
  locale           text NOT NULL DEFAULT 'en-GB',

  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- Backend-only, same posture as `saved_gyms` (20260726120000): the SST API
-- reaches this through getDb()'s pooler connection, which bypasses RLS. RLS on
-- with zero policies closes it to PostgREST — without which any `authenticated`
-- user could read every other user's dietary and allergen data, which is
-- special-category-adjacent under UK GDPR.
ALTER TABLE nutrition_preferences ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE nutrition_preferences IS 'Mealprint (spec-26): one row per user — dietary patterns, allergen avoidances, dislikes, likes, meal count, effort, locale. Read by every Mealprint generation. Backend-only: RLS on, no policies.';

-- ── Ingredient feedback (AC 7.2) ─────────────────────────────────────────────
-- Append-only curation signal behind "Hard to find near me". No UI reads it;
-- it exists so the aggregate ("which ingredients do UK users keep rejecting?")
-- feeds the catalogue backlog. The user-facing effect of the tap is the
-- `avoid_foods` append above — this table is telemetry, so losing a row is
-- harmless and it carries no constraints beyond the FK.
--
-- `food_id` and `custom_name` are BOTH nullable because the affordance sits on
-- rows of either kind: a resolved catalogue ingredient has an id, an
-- AI-composed one may only have a name. A CHECK requiring at least one keeps a
-- row that identifies nothing from being written.
CREATE TABLE IF NOT EXISTS mealprint_ingredient_feedback (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  food_id     uuid REFERENCES foods(id) ON DELETE SET NULL,
  custom_name text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mealprint_ingredient_feedback_identifies_something CHECK (
    food_id IS NOT NULL OR custom_name IS NOT NULL
  )
);

-- The only intended read is the aggregate backlog query (group by food_id /
-- custom_name over a recent window), plus a per-user read for de-duplication.
CREATE INDEX IF NOT EXISTS mealprint_ingredient_feedback_food_idx
  ON mealprint_ingredient_feedback (food_id);

CREATE INDEX IF NOT EXISTS mealprint_ingredient_feedback_user_created_idx
  ON mealprint_ingredient_feedback (user_id, created_at DESC);

ALTER TABLE mealprint_ingredient_feedback ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE mealprint_ingredient_feedback IS 'Mealprint (spec-26) AC 7.2: append-only "hard to find near me" signal feeding the catalogue-curation backlog. Telemetry only — the user-visible effect of the tap is the nutrition_preferences.avoid_foods append. Backend-only: RLS on, no policies.';
