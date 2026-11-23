-- Rollback for 20261123120117_coach_events_notifications.sql (PER-117).
--
-- ⚠ Roll back the core deploy FIRST, and remove coachSchedulerCron: the coach
-- notification routes, the event writers and the scheduler read these tables.
-- Dropping them loses every coach event and notification setting.
--
-- The notification_type values ('coach_event', 'form_request',
-- 'form_reminder') stay: Postgres can't drop an enum value. They are unused
-- once the deploy is rolled back, and the forward migration re-adds them
-- with IF NOT EXISTS.
DROP TABLE IF EXISTS coach_scheduler_runs;
DROP TABLE IF EXISTS coach_notification_settings;
DROP TABLE IF EXISTS coach_events;
