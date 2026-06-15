-- M4 (06-progress-goals) — extend notification_type enum for streak events.
--
-- The streak engine (06.2) and PR-detection notify path (06.3) emit three
-- NEW notification types that do not yet exist on the live enum
-- (packages/db/src/schema.ts:139 lists only the original nine values):
--
--   streak_milestone       — a streak crossed a milestone threshold
--   streak_at_risk         — last day of period, threshold not yet satisfied
--   freeze_token_applied   — nightly cron auto-spent a freeze token on a miss
--
-- Per specs/06-progress-goals/design.md § Notification triggers and
-- specs/_shared/cross-cuts.md § 5, the notification_type enum is *owned* by
-- 09-notifications-social (M7). This migration is the companion enum
-- extension M4 must sequence BEFORE the streak engine ships — otherwise the
-- first `INSERT INTO notifications` for any of these fails at runtime with
-- `invalid input value for enum notification_type`. M7 has already appended
-- these to the cross-cuts taxonomy table (PR #76) and to the mobile
-- NotificationType union; this file lands the DB side.
--
-- Why a standalone file: Postgres forbids *using* a newly added enum value
-- in the same transaction that adds it. Keeping the ADD VALUE statements in
-- their own migration (no usage here) sidesteps that entirely and mirrors
-- the precedent set by 20260512090238_m3_record_type_max_volume.sql.
--
-- Idempotent: ADD VALUE IF NOT EXISTS is a no-op on re-run. Append-only — no
-- value is ever removed, so this is forward/back safe (a rollback simply
-- leaves three unused enum values in place, which is harmless).

ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'streak_milestone';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'streak_at_risk';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'freeze_token_applied';
