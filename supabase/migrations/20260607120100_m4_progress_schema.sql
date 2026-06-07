-- M4 (06-progress-goals) — Progress / Goals / Home schema block.
--
-- One additive migration carrying the whole M4 schema surface per
-- specs/06-progress-goals/design.md § Drizzle migrations and
-- specs/_shared/cross-cuts.md § 6 (M4 owns this block; other specs read).
--
-- Scope:
--   1. profiles.timezone          — user-local TZ for streak period rollover
--   2. user_goals extensions      — assigned_by_user_id + target/current/unit
--   3. workout_sessions / body_measurements .logged_by_user_id (M8 fills later)
--   4. streak_type_enum + user_streaks
--   5. habit_completions
--   6. weekly_volume_per_user + volume_by_muscle_per_user (materialised aggs)
--
-- NOT in scope (already on the live schema — running CREATE TABLE would fail
-- with `relation already exists`): personal_records (schema.ts:532),
-- achievements (:580), user_achievements (:590). The achievements *seed*
-- ships as a separate data migration (20260607120200) so rollback can target
-- just the seed.
--
-- Idempotent throughout: ADD COLUMN IF NOT EXISTS, CREATE TABLE IF NOT
-- EXISTS, CREATE INDEX IF NOT EXISTS, and a DO-block guard for CREATE TYPE
-- (which has no IF NOT EXISTS). Forward/back safe — all additive; a rollback
-- drops only net-new objects and never touches existing data.

-- ─── 1. profiles.timezone ──────────────────────────────────────────────────
-- cross-cuts § 3.4: streak periods evaluate against user-local time. The
-- nightly cron reads profiles.timezone (IANA identifier) to compute per-user
-- period rollover. tasks.md T-06.2.5 assumes this column exists; it did not,
-- so M4 adds it. NOT NULL DEFAULT applies retroactively to existing rows
-- without a table rewrite (PG 11+ constant-default optimisation).
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'Europe/London';

COMMENT ON COLUMN profiles.timezone IS
  'M4: IANA timezone identifier for user-local streak period rollover (cross-cuts § 3.4). Default Europe/London.';

-- ─── 2. user_goals extensions ──────────────────────────────────────────────
-- assigned_by_user_id (cross-cuts § 2): NULL = self-set; non-NULL = trainer
-- who assigned it. Intentionally not enum-typed. target/current/unit back the
-- goal-progress UI; nullable so existing goals are unaffected.
ALTER TABLE user_goals
  ADD COLUMN IF NOT EXISTS assigned_by_user_id UUID REFERENCES profiles(id);
ALTER TABLE user_goals
  ADD COLUMN IF NOT EXISTS target_value NUMERIC;
ALTER TABLE user_goals
  ADD COLUMN IF NOT EXISTS current_value NUMERIC;
ALTER TABLE user_goals
  ADD COLUMN IF NOT EXISTS unit TEXT;

CREATE INDEX IF NOT EXISTS user_goals_assigned_by_idx
  ON user_goals (assigned_by_user_id)
  WHERE assigned_by_user_id IS NOT NULL;

-- ─── 3. on-behalf logging columns (M8 populates) ───────────────────────────
-- cross-cuts § 1.1: nullable; NULL = self-logged, non-NULL = trainer logged
-- on behalf. M4 ships the columns; M8 lights up the write path. No backfill
-- needed (NULL is the correct historical value for every existing row).
ALTER TABLE workout_sessions
  ADD COLUMN IF NOT EXISTS logged_by_user_id UUID REFERENCES profiles(id);
ALTER TABLE body_measurements
  ADD COLUMN IF NOT EXISTS logged_by_user_id UUID REFERENCES profiles(id);

-- ─── 4. streak_type_enum + user_streaks ────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE streak_type_enum AS ENUM (
    'workout_streak',      -- weekly
    'habit_streak',        -- daily
    'measurement_streak',  -- weekly
    'nutrition_streak'     -- daily (M9-gated)
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS user_streaks (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  streak_type       streak_type_enum NOT NULL,
  source_goal_id    uuid REFERENCES user_goals(id) ON DELETE CASCADE,
  period            text NOT NULL CHECK (period IN ('daily','weekly','monthly')),
  current_count     integer NOT NULL DEFAULT 0,
  longest_count     integer NOT NULL DEFAULT 0,
  last_period_end   date NOT NULL,
  freeze_tokens     integer NOT NULL DEFAULT 0,
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active','broken','paused')),
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);

-- cross-cuts § 3.2: at most one user_streak per (user, source_goal) for
-- goal-driven streaks. Ad-hoc streaks (source_goal_id IS NULL) are exempt —
-- a partial unique index expresses exactly that.
CREATE UNIQUE INDEX IF NOT EXISTS user_streaks_user_source_goal_uq
  ON user_streaks (user_id, source_goal_id)
  WHERE source_goal_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS user_streaks_user_status
  ON user_streaks (user_id, status);

-- ─── 5. habit_completions ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS habit_completions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  goal_id         uuid NOT NULL REFERENCES user_goals(id) ON DELETE CASCADE,
  completed_at    timestamptz NOT NULL,
  value           numeric
);

-- One completion per user / goal / UTC day. The expression must be IMMUTABLE:
-- two-arg date_trunc(text, timestamptz) is only STABLE (session-TZ dependent),
-- so we cast through AT TIME ZONE 'UTC' to the timestamp-without-tz overload,
-- which IS immutable and index-safe. The streak engine re-buckets to
-- user-local time at query time (see design.md § habit_completions note).
CREATE UNIQUE INDEX IF NOT EXISTS habit_completions_user_goal_day_uq
  ON habit_completions (user_id, goal_id, (date_trunc('day', completed_at AT TIME ZONE 'UTC')));
CREATE INDEX IF NOT EXISTS habit_completions_user_goal_ts
  ON habit_completions (user_id, goal_id, completed_at DESC);

-- ─── 6. materialised volume aggregations ───────────────────────────────────
-- Populated by the 03:00 UTC cron (06.4) + on-session-complete backup
-- recompute. Without these the cron's INSERT fails with `relation does not
-- exist` and the read endpoints have nothing to serve.
CREATE TABLE IF NOT EXISTS weekly_volume_per_user (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  week_start    date NOT NULL,                  -- Monday 00:00 user-local
  volume_kg     numeric NOT NULL DEFAULT 0,     -- Σ weight × reps over the week
  session_count integer NOT NULL DEFAULT 0,
  computed_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, week_start)
);
CREATE INDEX IF NOT EXISTS weekly_volume_per_user_user_week
  ON weekly_volume_per_user (user_id, week_start DESC);

CREATE TABLE IF NOT EXISTS volume_by_muscle_per_user (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  window_start date NOT NULL,                   -- start of the request window
  window_kind  text NOT NULL CHECK (window_kind IN ('month','quarter','year','lifetime')),
  muscle_group text NOT NULL,                   -- muscle_groups.name (lowercase)
  volume_kg    numeric NOT NULL DEFAULT 0,
  computed_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, window_start, window_kind, muscle_group)
);
CREATE INDEX IF NOT EXISTS volume_by_muscle_per_user_user_window
  ON volume_by_muscle_per_user (user_id, window_kind, window_start DESC);
