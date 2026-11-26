-- Rollback for 20261125101831_programme_sequence_mode.sql (PER-112).
--
-- ⚠ Roll back the core deploy FIRST: programme assignment writes and reads use
-- these columns. Sequence-mode assignments keep their start_date (always
-- filled with the assignment date) and their workouts keep due_date = NULL,
-- so after rollback they read as dated programmes with undated workouts,
-- which 1.2.0 phones already handle.
DROP INDEX IF EXISTS workout_assignments_program_sequence_idx;
ALTER TABLE workout_assignments DROP COLUMN IF EXISTS sequence_index;
ALTER TABLE program_assignments
  DROP CONSTRAINT IF EXISTS program_assignments_schedule_mode_check;
ALTER TABLE program_assignments DROP COLUMN IF EXISTS schedule_mode;
