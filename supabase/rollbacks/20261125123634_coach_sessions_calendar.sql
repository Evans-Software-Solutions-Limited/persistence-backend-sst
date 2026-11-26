-- Rollback for 20261125123634_coach_sessions_calendar.sql (PER-123).
--
-- ⚠ Roll back the core deploy FIRST: the calendar and session routes, Today's
-- schedule, offboarding and the session-reminder scheduler job read these
-- tables. Dropping them loses every booking.
--
-- The notification_type value 'coach_session' stays: Postgres can't drop an
-- enum value. It is unused once the deploy is rolled back, and the forward
-- migration re-adds it with IF NOT EXISTS.
DROP TABLE IF EXISTS coach_session_attendees;
DROP TABLE IF EXISTS coach_sessions;
