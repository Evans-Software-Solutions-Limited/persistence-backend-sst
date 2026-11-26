-- PER-112 (BE-G1b) — Backend design G, migration 9 (programmes part):
-- programmes in order with Next, no dates
-- (Linear: "Backend design G — Reps per set and programmes without dates",
-- part 2). The set-targets half of migration 9 shipped in
-- 20261123230809_workout_exercise_set_targets.sql (PER-111).
--
--   * program_assignments.schedule_mode: 'dated' (today's behaviour, the
--     default, so every existing row stays dated) or 'sequence' (no dates:
--     workouts in programme order, Next = lowest not yet completed).
--   * workout_assignments.sequence_index: the position in programme order
--     (week, then sort_order, then day_of_week as a tie-break). NULL for
--     dated and stand-alone workout assignments.
--
-- Additive and idempotent: two new columns (one NOT NULL with a default, on a
-- table that gets a value for every row from that default), one CHECK, one
-- partial index. Re-running is a no-op. Existing rows are unchanged.
-- Rollback: supabase/rollbacks/20261125101831_programme_sequence_mode.sql

ALTER TABLE program_assignments
  ADD COLUMN IF NOT EXISTS schedule_mode text NOT NULL DEFAULT 'dated';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'program_assignments_schedule_mode_check'
  ) THEN
    ALTER TABLE program_assignments
      ADD CONSTRAINT program_assignments_schedule_mode_check
      CHECK (schedule_mode IN ('dated', 'sequence'));
  END IF;
END $$;

ALTER TABLE workout_assignments
  ADD COLUMN IF NOT EXISTS sequence_index integer NULL;

CREATE INDEX IF NOT EXISTS workout_assignments_program_sequence_idx
  ON workout_assignments (program_assignment_id, sequence_index)
  WHERE sequence_index IS NOT NULL;
