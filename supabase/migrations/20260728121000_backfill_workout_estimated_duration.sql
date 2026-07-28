-- Backfill `workouts.estimated_duration_minutes` for rows stored under the V2
-- flat default.
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
--     (keyed on sort_order, which is NOT NULL and unique within a workout; the
--     's:'/'g:' prefixes keep the two key spaces from colliding)
--   • per exercise: sets × 75s work + (sets − 1) × rest_seconds
--   • plus 120s between groups, not after the last
--   • round UP to the nearest 5 minutes
-- Nullable columns fall back exactly as the TypeScript does: 1 set, 90s rest.
--
-- ⚠ SCOPE — this is the delicate part. Targeting "every row that says 30" is
-- WRONG, because 30 is not exclusively the V2 default. The legacy app
-- (persistence-mobile, still live against this same database) computes its own
-- estimate in the screen and sends it explicitly on both create and edit:
--
--     max(15, 2 × exerciseCount + totalSets)     -- workout-creator.tsx:161
--
-- which lands on exactly 30 for very ordinary plans (5 exercises × 4 sets;
-- 6 exercises × 3 sets). Those 30s are deliberate values, and overwriting them
-- would both destroy user-visible data with no down path AND start a flip-flop:
-- the next edit in legacy recomputes 30 and writes it straight back.
--
-- So a row is only rewritten when it says 30 AND that 30 is NOT what legacy's
-- formula would have produced for its own exercise rows. A V2-defaulted 30 on a
-- plan legacy would have costed at 30 anyway is left alone — indistinguishable
-- from a legacy row, and harmless, since the value is already right by legacy's
-- reckoning.
--
-- A workout with no exercise rows keeps 30: there is nothing to estimate from,
-- and 0 would render "0m".
--
-- Idempotent for the one-off apply: re-running recomputes the same value for
-- any row still at 30 and touches nothing else. Note for anyone re-running it
-- LATER — as of this change `POST /workouts` passes an explicit
-- `estimatedDurationMinutes` straight through, so once a client starts sending
-- a deliberate 30 this predicate can no longer tell it apart from the default.
-- No client sends one today.

WITH per_group AS (
  SELECT
    we.workout_id,
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
    pg.workout_id,
    SUM(pg.work_seconds) + GREATEST(COUNT(*) - 1, 0) * 120 AS total_seconds,
    -- Legacy's inputs, counted over the SAME rows, so its formula can be
    -- replayed per workout below.
    (SELECT COUNT(*) FROM workout_exercises w2 WHERE w2.workout_id = pg.workout_id)
      AS n_exercises,
    (SELECT COALESCE(SUM(COALESCE(w2.target_sets, 0)), 0)
       FROM workout_exercises w2 WHERE w2.workout_id = pg.workout_id)
      AS total_sets
  FROM per_group pg
  GROUP BY pg.workout_id
)
UPDATE workouts w
SET estimated_duration_minutes =
      (CEIL(CEIL(pw.total_seconds::numeric / 60) / 5) * 5)::int
FROM per_workout pw
WHERE pw.workout_id = w.id
  AND w.estimated_duration_minutes = 30
  -- Not a value legacy would have authored for this plan.
  AND 30 <> GREATEST(15, 2 * pw.n_exercises + pw.total_sets)
  -- No-op rows changed nothing anyway; skip the write.
  AND (CEIL(CEIL(pw.total_seconds::numeric / 60) / 5) * 5)::int <> 30;
