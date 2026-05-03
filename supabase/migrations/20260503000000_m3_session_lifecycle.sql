-- M3 Active Session — additive schema columns required by the offline-first
-- session lifecycle. See specs/05-active-session/design.md § Domain Model and
-- specs/milestones/M3-active-session/BACKEND_BRIEF.md § 1.
--
-- Applied to Supabase Postgres directly. Idempotent: safe to re-run.

-- workout_sessions: track mutation timestamp (referenced in CLAUDE.md
-- § "Status Transitions"; previously declared but never on the table).
ALTER TABLE workout_sessions
  ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now();

-- Backfill updated_at for existing rows so the column is meaningful from
-- day one. created_at is the closest signal we have for legacy rows.
UPDATE workout_sessions
SET updated_at = COALESCE(updated_at, created_at, now())
WHERE updated_at IS NULL;

-- session_exercises: superset grouping + exercise-substitution metadata.
ALTER TABLE session_exercises
  ADD COLUMN IF NOT EXISTS superset_group integer;

ALTER TABLE session_exercises
  ADD COLUMN IF NOT EXISTS is_substituted boolean NOT NULL DEFAULT false;

ALTER TABLE session_exercises
  ADD COLUMN IF NOT EXISTS original_exercise_id uuid
  REFERENCES exercises(id) ON DELETE SET NULL;

-- exercise_sets: explicit completion flag + timestamp. The session logger
-- writes is_completed = true and completed_at = now() when the user taps
-- "Mark Complete"; the rest timer and PR detection key off these.
ALTER TABLE exercise_sets
  ADD COLUMN IF NOT EXISTS is_completed boolean NOT NULL DEFAULT false;

ALTER TABLE exercise_sets
  ADD COLUMN IF NOT EXISTS completed_at timestamp with time zone;
