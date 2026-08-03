-- Index for the nightly retention sweep's prune of `client_data_access_log`.
--
-- The table has two indexes from 20260721000000_client_data_access_log.sql:
--   (client_id, created_at DESC)  and  (trainer_id, client_id, created_at DESC)
-- Neither LEADS with `created_at`, so the sweep's `WHERE created_at < $1` was a
-- sequential scan — on a table that migration itself describes as "high-volume".
--
-- This matters most on the FIRST run: the 12-month prune was written in SQL in
-- January 2026 but never actually executed (the function was admin-gated on
-- auth.uid() and nothing scheduled it), so the first sweep after
-- `application/retention/dataRetentionSweep.ts` ships faces the entire
-- accumulated backlog in one statement, inside a 300s Lambda.
--
-- Idempotent: IF NOT EXISTS, so a re-run is a no-op.
CREATE INDEX IF NOT EXISTS client_data_access_log_created_at_idx
  ON client_data_access_log (created_at);

COMMENT ON INDEX client_data_access_log_created_at_idx IS
  'Supports the nightly 12-month retention prune in application/retention/dataRetentionSweep.ts. The two (…, created_at DESC) indexes do not lead with created_at and so cannot serve a bare created_at < cutoff predicate.';
