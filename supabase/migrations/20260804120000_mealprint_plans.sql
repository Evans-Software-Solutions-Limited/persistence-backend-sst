-- Mealprint (spec-26) Phase 2 — `meal_plans` + `meal_plan_meals`
-- (design § 2.3; AC 4.x, 5.x). Day plans now; week plans (Phase 3) are seven
-- rows sharing a `group_id`, which is why that column arrives here rather than
-- in a second migration.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS with inline CHECKs, and every index
-- guarded. A re-run is a no-op.
--
-- ⚠ ADDITIVE ONLY, deliberately. `nutrition_entries` gains NOTHING: the linkage
-- lives on the plan side (`meal_plan_meals.logged_entry_id`), so the hot logging
-- table and its `meal_slot` CHECK are untouched (locked decision 6). That also
-- means deleting a plan can never cascade into a user's food log — see the FK
-- notes below.

-- ── meal_plans ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS meal_plans (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  -- 'draft' exists so an accepted plan and a reviewed-but-abandoned one are
  -- distinguishable and the latter is garbage-collectable. ⚠ In v1 the
  -- generate step is STATELESS (design § 3: plan-generate returns a payload and
  -- persists nothing), so no 'draft' row is written by any current path. The
  -- state is here because Phase 3's async week generation cannot be stateless —
  -- a job that runs for minutes has to park its result somewhere.
  status             text NOT NULL DEFAULT 'draft'
    CONSTRAINT meal_plans_status_known CHECK (
      status IN ('draft', 'active', 'archived')
    ),

  plan_date          date NOT NULL,

  -- NULL for a single day. Phase 3's week is seven rows sharing one group_id;
  -- the shopping list is then a read-time aggregation over the group, which is
  -- why it is stored nowhere (design § 2.3).
  group_id           uuid,

  -- Snapshot of the generation inputs, not a live join to
  -- nutrition_preferences. A user who changes their meal count must not
  -- retroactively alter a plan they already accepted.
  meals_per_day      integer NOT NULL
    CONSTRAINT meal_plans_meals_range CHECK (meals_per_day BETWEEN 2 AND 6),

  effort_level       text NOT NULL
    CONSTRAINT meal_plans_effort_known CHECK (
      effort_level IN ('quick', 'balanced', 'high_maintenance')
    ),

  -- Snapshot of `nutrition_targets` AT ACCEPT (design § 2.3). Same reasoning as
  -- the two columns above, and the reason adherence stays honest: a user who
  -- re-cuts their macros next month has not silently rewritten what last
  -- month's plan was aiming at. NOT NULL because a plan with no target is not a
  -- plan — the accept path resolves targets server-side before insert.
  target_kcal        numeric NOT NULL,
  target_protein_g   numeric NOT NULL,
  target_carbs_g     numeric NOT NULL,
  target_fat_g       numeric NOT NULL,

  source             text NOT NULL DEFAULT 'ai'
    CONSTRAINT meal_plans_source_known CHECK (source IN ('ai', 'manual', 'coach')),

  -- Future coach-authored plans. NULL means self-authored in v1; it is NOT
  -- defaulted to user_id, so "a coach made this" stays distinguishable from
  -- "we do not know". ON DELETE SET NULL: a departing coach must not delete a
  -- client's plans.
  created_by_user_id uuid REFERENCES profiles(id) ON DELETE SET NULL,

  created_at         timestamptz NOT NULL DEFAULT now(),
  accepted_at        timestamptz
);

-- One ACTIVE plan per user per date (design § 2.3). Partial, so archived and
-- draft rows accumulate freely — history and abandoned drafts are both
-- expected. ⚠ This is the constraint the accept path relies on to make
-- "replace today's plan" safe under a double tap: the second insert fails
-- rather than leaving a user with two active plans for one day.
CREATE UNIQUE INDEX IF NOT EXISTS meal_plans_one_active_per_date
  ON meal_plans (user_id, plan_date)
  WHERE status = 'active';

-- The Today/history read: "my plan for this date", and "my recent plans".
CREATE INDEX IF NOT EXISTS meal_plans_user_date_idx
  ON meal_plans (user_id, plan_date DESC);

-- Phase 3's group reads (week view, shopping list). Partial — the vast majority
-- of rows are single days with a NULL group_id and would only bloat it.
CREATE INDEX IF NOT EXISTS meal_plans_group_idx
  ON meal_plans (group_id)
  WHERE group_id IS NOT NULL;

ALTER TABLE meal_plans ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE meal_plans IS 'Mealprint (spec-26) Phase 2: one row per planned day. Week plans are seven rows sharing group_id. Targets/meals_per_day/effort are snapshots taken at accept, never live joins, so changing preferences cannot rewrite an accepted plan. Backend-only: RLS on, no policies.';

-- ── meal_plan_meals ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS meal_plan_meals (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- CASCADE is correct HERE and only here: a meal has no meaning without its
  -- plan. Contrast logged_entry_id below.
  plan_id         uuid NOT NULL REFERENCES meal_plans(id) ON DELETE CASCADE,

  sort_order      integer NOT NULL,
  label           text NOT NULL,

  -- Matches `nutrition_entries.meal_slot`'s vocabulary exactly
  -- (20260621120000, line 134). It MUST stay in step: the log path copies this
  -- value straight onto the entry, so a value legal here and illegal there
  -- would fail at write time with a constraint violation rather than a 400.
  log_slot        text NOT NULL
    CONSTRAINT meal_plan_meals_slot_known CHECK (
      log_slot IN ('breakfast', 'lunch', 'snack', 'dinner')
    ),

  -- A meal is backed by a composed/saved recipe, the user's own saved meal
  -- preset, or a one-off item list. All three are nullable and there is
  -- deliberately NO check requiring exactly one:
  --   * SET NULL on both FKs means a row that WAS recipe-backed legitimately
  --     becomes source-less when the recipe is deleted, and the denormalised
  --     macros below are what keep it readable. A strict XOR check would make
  --     that deletion fail.
  --   * `items` can legitimately coexist with a recipe for a composed meal.
  recipe_id       uuid REFERENCES recipes(id) ON DELETE SET NULL,
  meal_id         uuid REFERENCES meals(id) ON DELETE SET NULL,

  -- [{ foodId, servings }] for one-off lists. Shape is validated in the
  -- handler, not here — jsonb CHECKs are unmaintainable and the repository is
  -- the only writer.
  items           jsonb,

  -- Denormalised so a meal survives deletion of the recipe/meal it came from
  -- (design § 2.3). This is the same reasoning as `nutrition_entries` storing
  -- macros at write time, and it is why a future OFF re-seed cannot rewrite
  -- history.
  kcal            numeric NOT NULL,
  protein_g       numeric NOT NULL,
  carbs_g         numeric NOT NULL,
  fat_g           numeric NOT NULL,

  ai_reason       text,

  state           text NOT NULL DEFAULT 'planned'
    CONSTRAINT meal_plan_meals_state_known CHECK (
      state IN ('planned', 'logged', 'skipped')
    ),

  -- ⚠ SET NULL, never CASCADE, and this is the load-bearing half of "entries
  -- survive" (AC 5.4). Deleting a PLAN cascades to its meals but must never
  -- reach the food log; deleting an ENTRY must unlink rather than delete the
  -- planned meal. A CASCADE in either direction here would let a plan tidy-up
  -- silently destroy logged nutrition data.
  logged_entry_id uuid REFERENCES nutrition_entries(id) ON DELETE SET NULL
);

-- The only ordered read: a plan's meals in display order.
CREATE UNIQUE INDEX IF NOT EXISTS meal_plan_meals_plan_order_idx
  ON meal_plan_meals (plan_id, sort_order);

-- Reverse lookup for the unlink-on-entry-delete path and adherence reads.
CREATE INDEX IF NOT EXISTS meal_plan_meals_entry_idx
  ON meal_plan_meals (logged_entry_id)
  WHERE logged_entry_id IS NOT NULL;

ALTER TABLE meal_plan_meals ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE meal_plan_meals IS 'Mealprint (spec-26) Phase 2: the meals of one planned day. Macros are denormalised so a meal survives deletion of its backing recipe/meal. logged_entry_id is ON DELETE SET NULL in both directions so plan tidy-up can never destroy logged nutrition entries (AC 5.4). Backend-only: RLS on, no policies.';

-- ── recipes.source gains 'ai_generated' (task 2.1) ──────────────────────────
-- ⚠ NO DDL IS REQUIRED AND NONE SHOULD BE ADDED. `recipes.source` is a bare
-- `text NOT NULL DEFAULT 'manual'` with the legal values recorded only in a
-- line comment (20260621120000, line 74) — there has never been a CHECK
-- constraint on it. A future session reading "recipes.source gains
-- 'ai_generated'" in tasks.md must not write an ALTER ... DROP CONSTRAINT for a
-- constraint that does not exist; the accept path simply writes the new value,
-- and `schema.ts` carries the updated comment.
COMMENT ON COLUMN recipes.source IS 'manual | url_import | ai_extracted | ai_generated. ai_generated is written by Mealprint''s plan-accept path (spec-26 Phase 2) for recipes composed by the model. Intentionally unconstrained at the DB level.';
