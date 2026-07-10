-- M18 (Live-session / Swap) — record the original workout when a coach swaps
-- an assignment's workout in place.
--
-- PATCH /trainers/me/clients/:clientId/workout-assignments/:id updates
-- workout_assignments.workout_id to the replacement and stamps the ORIGINAL
-- here (COALESCE-first in the repo, so it survives re-swaps and always points
-- at the true original). NULL = never swapped. For a programme occurrence this
-- flags "override of the programmed workout" while program_assignment_id stays
-- intact (adherence tracking preserved).
--
-- Nullable, no default, FK → workouts ON DELETE SET NULL (mirrors
-- completed_session_id's set-null posture). Idempotent: ADD COLUMN IF NOT
-- EXISTS. Backfill: none — existing rows are unswapped (NULL).

ALTER TABLE workout_assignments
  ADD COLUMN IF NOT EXISTS swapped_from_workout_id uuid
  REFERENCES workouts(id) ON DELETE SET NULL;
