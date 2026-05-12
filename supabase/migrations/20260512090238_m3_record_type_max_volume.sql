-- M3 Active Session — broaden PR detection beyond Epley-derived 1rm.
-- The summary screen surfaces PRs across (1rm, max_weight, max_volume); the
-- first two enum values already exist, max_volume is added here.
--
-- See specs/05-active-session/design.md § Personal-record detection,
-- microservices/core/src/application/repositories/personalRecordsRepository.ts
-- (recordPRsForSession).
--
-- Applied to Supabase Postgres directly. Idempotent: ADD VALUE IF NOT EXISTS
-- is a no-op on a re-run.

ALTER TYPE record_type ADD VALUE IF NOT EXISTS 'max_volume';
