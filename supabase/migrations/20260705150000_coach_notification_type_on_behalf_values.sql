-- M8 (10-trainer-features) — extend notification_type enum for the trainer
-- on-behalf / assignment notifications (Coach Mode Completion, Phase 3).
--
-- Phase 3 (10.3) is the FIRST milestone to emit trainer on-behalf
-- notifications, so it must land the companion enum ADD VALUE statements
-- BEFORE any handler inserts one of these. The current live enum
-- (packages/db/src/schema.ts) ends at daily_nutrition_target_hit; these four
-- NEW values do not yet exist:
--
--   goal_assigned_by_trainer         — a coach assigned a goal to a client
--   workout_logged_on_behalf         — a coach logged a session for a client
--   measurement_logged_on_behalf     — a coach logged a measurement for a client
--   nutrition_target_set_by_trainer  — a coach set a client's nutrition target
--
-- Per specs/_shared/cross-cuts.md § 5 and specs/10-trainer-features/design.md
-- § Frontend — Notification triggers, the notification_type enum is *owned* by
-- 09-notifications-social (M7); each producing spec sequences its own ADD VALUE
-- before it emits. Without this migration the first
-- `INSERT INTO notifications` for any of these fails at runtime with
-- `invalid input value for enum notification_type`.
--
-- NOTE: `workout_assigned` is deliberately NOT added here — it already exists
-- on the live enum (schema.ts, the original nine values). The
-- POST /workout-assignments on-behalf handler reuses it.
--
-- Why a standalone file: Postgres forbids *using* a newly added enum value in
-- the same transaction that adds it. Keeping the ADD VALUE statements in their
-- own migration (no usage here) sidesteps that entirely — mirrors the M4
-- precedent (20260607120000_m4_notification_type_streak_values.sql) and the M9
-- precedent (20260621120100_m9_notification_type_target_hit.sql).
--
-- Idempotent: ADD VALUE IF NOT EXISTS is a no-op on re-run. Append-only —
-- forward/back safe (a rollback leaves four unused enum values, harmless).

ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'goal_assigned_by_trainer';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'workout_logged_on_behalf';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'measurement_logged_on_behalf';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'nutrition_target_set_by_trainer';
