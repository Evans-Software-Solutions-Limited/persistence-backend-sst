-- Rollback for 20261126120402_client_ai_summary_areas.sql (PER-115).
--
-- ⚠ Roll back the core deploy FIRST: the summary route reads and writes these
-- columns. `summary` was written on every row throughout, so 1.2.0 bundles
-- and the previous core build read cached summaries unchanged afterwards.
ALTER TABLE client_ai_summaries DROP COLUMN IF EXISTS week_of_programme;
ALTER TABLE client_ai_summaries DROP COLUMN IF EXISTS ask;
ALTER TABLE client_ai_summaries DROP COLUMN IF EXISTS areas;
ALTER TABLE client_ai_summaries DROP COLUMN IF EXISTS headline;
