-- Rollback for 20261120235941_coach_forms.sql (PER-116).
--
-- ⚠ Roll back the core deploy FIRST: the forms routes and the accept and
-- offboarding hooks read these tables. Dropping them loses every coach form,
-- send rule, request and response.
DROP TABLE IF EXISTS coach_form_responses;
DROP TABLE IF EXISTS coach_form_requests;
DROP TABLE IF EXISTS coach_form_schedule_clients;
DROP TABLE IF EXISTS coach_form_schedules;
ALTER TABLE IF EXISTS coach_forms DROP CONSTRAINT IF EXISTS coach_forms_current_version_fkey;
DROP TABLE IF EXISTS coach_form_versions;
DROP FUNCTION IF EXISTS coach_form_versions_immutable();
DROP TABLE IF EXISTS coach_forms;
