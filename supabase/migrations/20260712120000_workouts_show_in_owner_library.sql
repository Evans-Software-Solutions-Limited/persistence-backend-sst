-- Workout Authoring v2 — owner-visibility flag.
--
-- Adds workouts.show_in_owner_library: does this workout appear in its AUTHOR's
-- personal "My Workouts" page? This is distinct from:
--   * workout_assignments.show_in_library — a coach's per-assignment flag for
--     whether an ASSIGNED occurrence clutters the CLIENT's library (spec-19 D3);
--   * the workout_visibility enum — owner-side social sharing (private/friends/
--     public), unchanged here.
--
-- Default true so every pre-existing workout, and every workout authored via the
-- athlete Train->Workouts path, stays personal (correct — those ARE the author's
-- personal workouts). Workouts authored in a coach context are created with
-- false by the app so a coach's client-authoring library doesn't crowd their own
-- personal My Workouts. Trainers get the de-crowded view via the opt-in
-- `ownerLibraryOnly=true` query param on GET /workouts?type=mine.
--
-- NOT NULL DEFAULT true backfills every existing row in a single statement.
-- Idempotent: ADD COLUMN IF NOT EXISTS.

ALTER TABLE workouts
  ADD COLUMN IF NOT EXISTS show_in_owner_library boolean NOT NULL DEFAULT true;
