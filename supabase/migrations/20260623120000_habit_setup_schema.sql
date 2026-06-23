-- 18-habit-setup — Habit Setup schema block.
--
-- Additive migration per specs/18-habit-setup/design.md § 2 and the
-- specs/_shared/cross-cuts.md § 3 "Revised 2026-06-23" amendment. M4 owns
-- goal_types / user_goals / user_streaks / habit_completions; this block adds
-- per-habit configuration + planned-pause storage on top, and seeds the five
-- fixed habit goal_types.
--
-- Scope:
--   1. habit_category_enum + habit_completion_rule_enum
--   2. habit_configs   — per-habit target / days-per-week / leniency + the
--                        deferred-edit columns (effective_from, pending_*)
--   3. streak_holidays — all-habits planned pause (UI lives on Home)
--   4. seed five goal_types (water/gym/steps/sleep/calories)
--
-- The collection habit streak reuses the EXISTING user_streaks row
-- (source_goal_id NULL, streak_type='habit_streak', period='weekly'); no new
-- streak columns. A weekly streak's existing "1 freeze token per missed
-- period" already models "a token = a week off", so no freeze_until is needed.
--
-- Idempotent throughout (DO-block enums, IF NOT EXISTS tables/indexes,
-- ON CONFLICT seed). Forward/back safe — all additive; a rollback drops only
-- net-new objects and never touches existing data.

-- ─── 1. Enums ────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE habit_category_enum AS ENUM ('water','gym','steps','sleep','calories');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE habit_completion_rule_enum AS ENUM ('count','value_gte','within_tolerance');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── 2. habit_configs ────────────────────────────────────────────────────────
-- One row per enabled habit (1:1 with the backing user_goals row). `period` +
-- `completion_rule` are server-derived from the category (the client can't pick
-- them). `days_per_week` is the weekly slack (NULL for Gym, whose sessions/week
-- IS the target). `effective_from` is the first week-start (Mon, user-local)
-- the habit counts toward the streak; `pending_config`/`pending_from` carry a
-- deferred edit promoted at the weekly rollover so an edit never changes the
-- in-progress week's bar (anti-gaming, design.md § 4.4).
CREATE TABLE IF NOT EXISTS habit_configs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  goal_id          uuid NOT NULL REFERENCES user_goals(id) ON DELETE CASCADE,
  category         habit_category_enum NOT NULL,
  target_value     numeric NOT NULL,
  unit             text NOT NULL,
  period           text NOT NULL,
  completion_rule  habit_completion_rule_enum NOT NULL,
  days_per_week    integer,
  tolerance_pct    numeric,
  effective_from   date NOT NULL,
  pending_config   jsonb,
  pending_from     date,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT habit_configs_period_chk CHECK (period IN ('daily','weekly')),
  CONSTRAINT habit_configs_dpw_chk    CHECK (days_per_week IS NULL OR days_per_week BETWEEN 1 AND 7),
  CONSTRAINT habit_configs_target_chk CHECK (target_value > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS habit_configs_goal_uq     ON habit_configs (goal_id);
CREATE UNIQUE INDEX IF NOT EXISTS habit_configs_user_cat_uq ON habit_configs (user_id, category);
CREATE INDEX        IF NOT EXISTS habit_configs_user_idx    ON habit_configs (user_id);

-- ─── 3. streak_holidays ──────────────────────────────────────────────────────
-- Planned pause. goal_id NULL = applies to ALL the user's habits (the default;
-- holidays are scheduled for the whole collection from Home). The ≥24h-advance
-- and end-early rules are handler-enforced (tz-relative); the CHECK only guards
-- range ordering.
CREATE TABLE IF NOT EXISTS streak_holidays (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  goal_id     uuid REFERENCES user_goals(id) ON DELETE CASCADE,
  start_date  date NOT NULL,
  end_date    date NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT streak_holidays_range_chk CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS streak_holidays_user_idx ON streak_holidays (user_id, start_date);

-- ─── 4. Seed the five fixed habit goal_types ─────────────────────────────────
-- Stable slugs; handlers resolve category → goal_type_id by name. goal_types.name
-- is UNIQUE, so the upsert is idempotent across re-runs.
INSERT INTO goal_types (name, description, category, icon_name) VALUES
  ('water',    'Daily hydration habit', 'habit', 'droplet'),
  ('gym',      'Weekly training habit', 'habit', 'dumbbell'),
  ('steps',    'Daily steps habit',     'habit', 'footprints'),
  ('sleep',    'Nightly sleep habit',   'habit', 'moon'),
  ('calories', 'Daily calorie habit',   'habit', 'flame')
ON CONFLICT (name) DO UPDATE
  SET category = EXCLUDED.category, icon_name = EXCLUDED.icon_name;
