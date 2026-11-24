-- Rollback for 20261123230809_workout_exercise_set_targets.sql (PER-111).
--
-- ⚠ Roll back the core deploy FIRST: workout reads and writes use this table.
-- Dropping it loses every per-set prescription. The derived workout_exercises
-- columns (target_sets, target_reps_min/max) were always written alongside, so
-- every workout keeps its set count and rep range: 10 / 8 / 8 reads as
-- "3 × 8–10", exactly what 1.2.0 phones already show.
DROP TABLE IF EXISTS workout_exercise_set_targets;
