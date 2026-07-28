-- Backfill `workouts.estimated_duration_minutes` for rows stored under the
-- old flat default.
--
-- Until 2026-07-28 the V2 app never derived a duration: the mobile form seeded
-- 30, sent it on every create, and both the create handler and the column
-- defaulted to 30 behind it. So every workout authored in V2 reads "30 min"
-- regardless of content — a 7-exercise session included. The code fix is
-- forward-only (see application/workouts/estimateDuration.ts), which would
-- leave every existing workout still lying about its length.
--
-- This applies the SAME heuristic in SQL, as a one-off:
--   • group by superset_group; a standalone exercise is its own group
--     (keyed on sort_order, unique within a workout)
--   • per exercise: sets × 75s work + (sets − 1) × rest_seconds
--   • plus 120s between groups, not after the last
--   • round UP to the nearest 5 minutes
-- Nullable columns fall back exactly as the TypeScript does: 1 set, 90s rest.
--
-- SCOPE — only rows where estimated_duration_minutes = 30 AND the workout
-- actually has exercises. 30 is the value that could only have come from the
-- default (no UI ever set this field, so no user intent is being overwritten),
-- and anything a coach set explicitly via the API to some other number is left
-- alone. A workout with no exercise rows keeps 30: there is nothing to
-- estimate from, and 0 would render "0m".
--
-- Idempotent: re-running recomputes the same value for any row still sitting
-- at 30, and touches nothing else. Safe to apply more than once.

WITH per_group AS (
  SELECT
    we.workout_id,
    -- Standalone exercises get a per-row key so they stay separate groups;
    -- supersetted rows collapse onto their shared group number.
    COALESCE('g:' || we.superset_group::text, 's:' || we.sort_order::text)
      AS group_key,
    SUM(
      COALESCE(we.target_sets, 1) * 75
      + GREATEST(COALESCE(we.target_sets, 1) - 1, 0) * COALESCE(we.rest_seconds, 90)
    ) AS work_seconds
  FROM workout_exercises we
  GROUP BY we.workout_id, group_key
),
per_workout AS (
  SELECT
    workout_id,
    SUM(work_seconds) + GREATEST(COUNT(*) - 1, 0) * 120 AS total_seconds
  FROM per_group
  GROUP BY workout_id
)
UPDATE workouts w
SET estimated_duration_minutes =
      (CEIL(CEIL(pw.total_seconds::numeric / 60) / 5) * 5)::int
FROM per_workout pw
WHERE pw.workout_id = w.id
  AND w.estimated_duration_minutes = 30
  AND (CEIL(CEIL(pw.total_seconds::numeric / 60) / 5) * 5)::int <> 30;
