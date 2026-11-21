-- Design D, migration 6 — the meal-plans part (PER-118, BE-D2).
--
-- Contract: Linear "Backend design D — One meal-plan model, your meals and
-- Mealprint" ("Data model", "Endpoints", "Access rule"). The your-meals and
-- entries part shipped in 20261120143109_your_meals_entry_idempotency.sql
-- (PER-109). Mealprint swaps and "save a day as a plan" are BE-D3 (PER-119) and
-- are NOT here.
--
-- 1. `nutrition_plans` — a named list of meals. No dates, no weekdays and no
--    target of its own: builders compare its totals with the person's
--    `nutrition_targets`. `revision` drives the offline 409; `client_request_id`
--    makes create and duplicate replay-safe.
-- 2. `nutrition_plan_meals` / `nutrition_plan_items` — the meals and their
--    foods. Item macros are computed by the server on write. The food, recipe
--    and saved-meal ids carry NO foreign key on purpose: an owner may delete a
--    recipe that a plan (or a client's copy of a coach plan) still lists, and
--    that delete must not fail. `display_name` keeps the row readable then.
-- 3. `nutrition_plan_assignments` — a coach's plan sent to a client. The coach
--    owns the plan, so coach edits reach the client live. A client may READ a
--    plan only while an assignment is 'sent' or 'added' on an ACTIVE
--    relationship (`NutritionPlanRepository.getReadable`); ending coaching or
--    archiving the plan sets assignments to 'removed'.
-- 4. `shopping_list_plans` — which plans feed the shopping list (ticks stay on
--    the phone, N23).
-- 5. `recipes.source_recipe_id` / `shared_by_user_id` — attribution for a
--    coach → client recipe share and for recipes copied by Duplicate.
-- 6. New enum values: `notification_type` 'meal_plan_assigned' (the push to
--    the client) and `action_type_enum` 'meal_plan_assigned' / 'recipe_shared'
--    (trainer_actions_audit). Not used inside this file, so ADD VALUE inside the
--    migration's transaction is safe (PG12+).
--
-- Purely additive: new tables, new NULLable columns, new indexes, new enum
-- values. No existing column, CHECK or default changes; 1.2.0 is unaffected.
--
-- ⚠ MIGRATE BEFORE DEPLOY. Declaring the two recipe columns in
-- packages/db/src/schema.ts puts them in Drizzle's explicit SELECT list, so a
-- core deploy that lands before this migration fails every recipe read with
-- 42703. The staging workflow already runs `supabase db push` before
-- `sst deploy`.
--
-- Re-runnable: IF NOT EXISTS throughout; CHECKs are added inside guarded DO
-- blocks.

CREATE TABLE IF NOT EXISTS nutrition_plans (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id          uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name              text NOT NULL,
  notes             text,
  source            text NOT NULL DEFAULT 'manual',
  -- Provenance only (Duplicate, Mealprint day). No FK: a copy outlives its source.
  source_plan_id    uuid,
  archived_at       timestamptz,
  revision          integer NOT NULL DEFAULT 1,
  client_request_id text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT nutrition_plans_name_len_chk
    CHECK (char_length(name) BETWEEN 1 AND 80),
  CONSTRAINT nutrition_plans_source_chk
    CHECK (source IN ('manual', 'mealprint', 'coach', 'duplicate')),
  CONSTRAINT nutrition_plans_revision_chk
    CHECK (revision >= 1)
);

-- ⚠ FULL unique index, not partial: Drizzle's ON CONFLICT emits no predicate
-- and Postgres can't infer a partial index without one (42P10). NULLs are
-- distinct, so rows without a key never conflict. Same as 20260727120100.
CREATE UNIQUE INDEX IF NOT EXISTS nutrition_plans_owner_client_request_idx
  ON nutrition_plans (owner_id, client_request_id);
-- `GET /nutrition/meal-plans?since=`.
CREATE INDEX IF NOT EXISTS nutrition_plans_owner_updated_idx
  ON nutrition_plans (owner_id, updated_at);

CREATE TABLE IF NOT EXISTS nutrition_plan_meals (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id     uuid NOT NULL REFERENCES nutrition_plans(id) ON DELETE CASCADE,
  name        text NOT NULL,
  log_slot    text NOT NULL,
  sort_order  integer NOT NULL DEFAULT 0,
  CONSTRAINT nutrition_plan_meals_name_len_chk
    CHECK (char_length(name) BETWEEN 1 AND 40),
  CONSTRAINT nutrition_plan_meals_log_slot_chk
    CHECK (log_slot IN ('breakfast', 'lunch', 'snack', 'dinner'))
);

CREATE INDEX IF NOT EXISTS nutrition_plan_meals_plan_idx
  ON nutrition_plan_meals (plan_id, sort_order);

CREATE TABLE IF NOT EXISTS nutrition_plan_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_meal_id  uuid NOT NULL REFERENCES nutrition_plan_meals(id) ON DELETE CASCADE,
  -- No FKs on the three references; see the header (2).
  food_id       uuid,
  recipe_id     uuid,
  meal_id       uuid,
  -- A one-off: {name, kcal, proteinG, carbsG, fatG} per serving.
  custom        jsonb,
  -- The source's name when the item was written, shown if the source is gone.
  display_name  text NOT NULL DEFAULT '',
  servings      numeric NOT NULL,
  kcal          numeric NOT NULL,
  protein_g     numeric NOT NULL,
  carbs_g       numeric NOT NULL,
  fat_g         numeric NOT NULL,
  sort_order    integer NOT NULL DEFAULT 0,
  CONSTRAINT nutrition_plan_items_servings_chk CHECK (servings > 0),
  CONSTRAINT nutrition_plan_items_one_source_chk CHECK (
    (food_id IS NOT NULL)::int + (recipe_id IS NOT NULL)::int
      + (meal_id IS NOT NULL)::int + (custom IS NOT NULL)::int = 1
  )
);

CREATE INDEX IF NOT EXISTS nutrition_plan_items_meal_idx
  ON nutrition_plan_items (plan_meal_id, sort_order);

CREATE TABLE IF NOT EXISTS nutrition_plan_assignments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id           uuid NOT NULL REFERENCES nutrition_plans(id) ON DELETE CASCADE,
  trainer_id        uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  client_id         uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  relationship_id   uuid NOT NULL REFERENCES pt_client_relationships(id) ON DELETE CASCADE,
  note              text,
  status            text NOT NULL DEFAULT 'sent',
  -- The plan revision the client last saw; `updatedSinceSeen` = revision > this.
  seen_revision     integer NOT NULL DEFAULT 0,
  sent_at           timestamptz NOT NULL DEFAULT now(),
  added_at          timestamptz,
  removed_at        timestamptz,
  -- Not in the design's column list: needed so `?since=` can report a status
  -- change (removed, ended coaching) to an offline client.
  updated_at        timestamptz NOT NULL DEFAULT now(),
  client_request_id text,
  CONSTRAINT nutrition_plan_assignments_status_chk
    CHECK (status IN ('sent', 'added', 'dismissed', 'removed')),
  CONSTRAINT nutrition_plan_assignments_note_len_chk
    CHECK (note IS NULL OR char_length(note) <= 500)
);

-- One live assignment per (plan, relationship). Partial on purpose: a removed
-- assignment can be re-sent. Written with a target-less ON CONFLICT DO NOTHING,
-- which matches partial indexes.
CREATE UNIQUE INDEX IF NOT EXISTS nutrition_plan_assignments_live_idx
  ON nutrition_plan_assignments (plan_id, relationship_id)
  WHERE status <> 'removed';
CREATE UNIQUE INDEX IF NOT EXISTS nutrition_plan_assignments_trainer_client_request_idx
  ON nutrition_plan_assignments (trainer_id, client_request_id);
CREATE INDEX IF NOT EXISTS nutrition_plan_assignments_client_idx
  ON nutrition_plan_assignments (client_id, updated_at);
CREATE INDEX IF NOT EXISTS nutrition_plan_assignments_relationship_idx
  ON nutrition_plan_assignments (relationship_id);

CREATE TABLE IF NOT EXISTS shopping_list_plans (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  nutrition_plan_id  uuid REFERENCES nutrition_plans(id) ON DELETE CASCADE,
  meal_plan_id       uuid REFERENCES meal_plans(id) ON DELETE CASCADE,
  added_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shopping_list_plans_one_plan_chk CHECK (
    (nutrition_plan_id IS NOT NULL)::int + (meal_plan_id IS NOT NULL)::int = 1
  )
);

-- FULL unique (see above); NULLs are distinct, so each index only constrains
-- rows of its own kind.
CREATE UNIQUE INDEX IF NOT EXISTS shopping_list_plans_user_nutrition_plan_idx
  ON shopping_list_plans (user_id, nutrition_plan_id);
CREATE UNIQUE INDEX IF NOT EXISTS shopping_list_plans_user_meal_plan_idx
  ON shopping_list_plans (user_id, meal_plan_id);

ALTER TABLE recipes
  ADD COLUMN IF NOT EXISTS source_recipe_id uuid
    REFERENCES recipes(id) ON DELETE SET NULL;
ALTER TABLE recipes
  ADD COLUMN IF NOT EXISTS shared_by_user_id uuid
    REFERENCES profiles(id) ON DELETE SET NULL;

-- A recipe is copied into an account at most once per source: the coach share
-- route and Duplicate both reuse an existing copy (idempotent on
-- (source_recipe_id, client)). FULL for the same 42P10 reason.
CREATE UNIQUE INDEX IF NOT EXISTS recipes_user_source_recipe_idx
  ON recipes (user_id, source_recipe_id);

-- Service-role only, like every table added since 20260626104105.
ALTER TABLE nutrition_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE nutrition_plan_meals ENABLE ROW LEVEL SECURITY;
ALTER TABLE nutrition_plan_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE nutrition_plan_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE shopping_list_plans ENABLE ROW LEVEL SECURITY;

ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'meal_plan_assigned';
ALTER TYPE action_type_enum ADD VALUE IF NOT EXISTS 'meal_plan_assigned';
ALTER TYPE action_type_enum ADD VALUE IF NOT EXISTS 'recipe_shared';
