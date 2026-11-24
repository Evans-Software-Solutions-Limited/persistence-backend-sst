-- PER-111 (BE-G1a) — Backend design G, migration 9 (set-targets part only):
-- different reps for each set of an exercise in a workout
-- (Linear: "Backend design G — Reps per set and programmes without dates",
-- part 1). The schedule_mode / sequence_index half of migration 9 belongs to
-- PER-112 (BE-G1b) and is NOT in this file.
--
-- `workout_exercises` holds one prescription per exercise (`target_sets`,
-- `target_reps_min`, `target_reps_max`). This adds one optional row per set,
-- so a workout can prescribe 10 / 8 / 8.
--
--   * No weight column: a prescription has no weight (canvas C5).
--   * The old columns stay authoritative for old readers. Whenever set targets
--     are written, core also writes target_sets = number of sets and
--     target_reps_min / target_reps_max = lowest / highest reps, so 1.2.0
--     bundles show "3 × 8–10" for 10 / 8 / 8.
--   * A workout exercise with no rows here behaves exactly as today. Existing
--     workouts get no rows and are unchanged.
--
-- Additive and idempotent: one new table, its index and RLS. Re-running is a
-- no-op. Rollback: supabase/rollbacks/20261123230809_workout_exercise_set_targets.sql
--
-- Service-role only (RLS on, no policies): read and written through the core
-- API, which authorizes through the parent workout.

CREATE TABLE IF NOT EXISTS workout_exercise_set_targets (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workout_exercise_id  uuid NOT NULL
    REFERENCES workout_exercises(id) ON DELETE CASCADE,
  set_number           smallint NOT NULL
    CONSTRAINT workout_exercise_set_targets_set_number_check
      CHECK (set_number BETWEEN 1 AND 20),
  target_reps          smallint NOT NULL
    CONSTRAINT workout_exercise_set_targets_target_reps_check
      CHECK (target_reps BETWEEN 1 AND 100),
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workout_exercise_set_targets_exercise_set_key
    UNIQUE (workout_exercise_id, set_number)
);

ALTER TABLE workout_exercise_set_targets ENABLE ROW LEVEL SECURITY;
