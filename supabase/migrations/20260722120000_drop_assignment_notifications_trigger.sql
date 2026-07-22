-- QA-10 (device-QA sweep, BRIEF-7) — drop the legacy per-row
-- `assignment_notifications` trigger on `workout_assignments`.
--
-- Root cause: this trigger (002_functions_and_triggers.sql) fires
-- `FOR EACH ROW` on INSERT, emitting one "New Workout Assigned" notification
-- PER ROW. The specs/19-programs assign path (ProgramAssignmentRepository
-- .assign / .ensureMaterializedForClient) materialises every occurrence of a
-- programme as an individual `workout_assignments` row in one bulk insert —
-- assigning ONE programme fired a flood of pushes (one per occurrence). The
-- ad-hoc single-workout assign path (assignClientWorkoutOnBehalf) already
-- emits its own app-level notification via emitTrainerOnBehalfNotification,
-- so it was ALSO double-notifying (trigger + app code) before this drop.
--
-- Fix: notifications for on-behalf assignments are now emitted exactly once,
-- in application code, post-commit, best-effort
-- (trainers/onBehalfNotifications.ts). The programme-assign handler
-- (trainers/programs/trainersProgramsAssignHandler.ts) gained its own single
-- emit alongside this migration. Dropping the trigger makes occurrence
-- materialisation (initial assign + the indefinite-horizon top-up in
-- ensureMaterializedForClient) silent at the DB layer, which is the desired
-- behaviour — the top-up must NOT notify at all.
--
-- Idempotent: `DROP TRIGGER IF EXISTS` / `DROP FUNCTION IF EXISTS` are no-ops
-- on re-run. Forward-only — no code path relies solely on this trigger for a
-- required notification (verified: `createAdHoc`'s only caller already emits
-- its own notification).

DROP TRIGGER IF EXISTS assignment_notifications ON workout_assignments;
DROP FUNCTION IF EXISTS create_assignment_notification();
