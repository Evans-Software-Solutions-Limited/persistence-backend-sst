ALTER TABLE workout_sessions
  ADD COLUMN IF NOT EXISTS activity_environment text,
  ADD COLUMN IF NOT EXISTS location_name text;

ALTER TABLE workout_sessions
  DROP CONSTRAINT IF EXISTS workout_sessions_activity_environment_check;

ALTER TABLE workout_sessions
  ADD CONSTRAINT workout_sessions_activity_environment_check
  CHECK (activity_environment IS NULL OR activity_environment IN ('indoor', 'outdoor'));
