-- Coach health-data read-audit (specs/27-coach-health-data-read-audit).
--
-- The backend already audits every coach on-behalf WRITE
-- (trainer_actions_audit, 20260705140000) but never a coach READ of a
-- client's special-category health data. Under UK GDPR accountability
-- (Art 5(2)) we must be able to demonstrate which coach viewed which
-- client's data, when, and via which route — both for the client's own
-- "who viewed my data" DSAR view and for compliance.
--
-- Append-only. One row per (trainer, client, data_category) READ, subject to
-- the read-audit helper's own de-dupe window (auditClientDataRead.ts,
-- DEDUPE_WINDOW_MINUTES) so a screen the coach leaves open / polls doesn't
-- write a row per request.
--
-- Idempotent: table + indexes use IF NOT EXISTS. Forward/back safe: a re-run
-- after data exists is a no-op (never drops).

CREATE TABLE IF NOT EXISTS client_data_access_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trainer_id    uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  client_id     uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  data_category text NOT NULL,
  route         text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- DSAR "who viewed my data" query — all reads of a client's data, newest first.
CREATE INDEX IF NOT EXISTS client_data_access_log_client_ts
  ON client_data_access_log (client_id, created_at DESC);

-- Coach-side / per-relationship lookups, and the read-audit helper's own
-- de-dupe-window check (trainer_id, client_id, data_category) scoped to a
-- recent time window.
CREATE INDEX IF NOT EXISTS client_data_access_log_trainer_client_ts
  ON client_data_access_log (trainer_id, client_id, created_at DESC);

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- Backend-only compliance table, same posture as trainer_actions_audit
-- (20260705140000): the SST API reaches it via getDb()'s RLS-bypassing pooler
-- connection, so no client-facing policy is needed or wanted — this is an
-- append-only trust/compliance log, not a PostgREST-exposed table. RLS-on +
-- zero policies = closed to PostgREST, open to the backend.
ALTER TABLE client_data_access_log ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE client_data_access_log IS 'Append-only audit of coach READS of client health/fitness data (specs/27-coach-health-data-read-audit, UK GDPR Art 5(2)). Backend-only: RLS on, no policies. Retention: 12 months, pruned via cleanup_old_health_data() (see 20260117235501_health_data_retention_policies.sql).';

-- ── Retention ────────────────────────────────────────────────────────────────
-- Fold client_data_access_log into the SAME admin-gated, manually-invoked
-- prune function health data already uses (cleanup_old_health_data(),
-- 20260117235501_health_data_retention_policies.sql) rather than inventing a
-- new mechanism (no pg_cron is wired up in this project). CREATE OR REPLACE
-- is idempotent; re-running this migration just redefines the same function.
CREATE OR REPLACE FUNCTION cleanup_old_health_data()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER := 0;
    activity_deleted INTEGER := 0;
    sleep_deleted INTEGER := 0;
    access_log_deleted INTEGER := 0;
    cutoff_date DATE;
    caller_id UUID;
BEGIN
    -- Get the caller's ID
    caller_id := auth.uid();

    -- Only allow admins to run cleanup
    IF caller_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM profiles
        WHERE id = caller_id AND role = 'admin'
    ) THEN
        RAISE EXCEPTION 'Access denied: Admin privileges required for data cleanup';
    END IF;
    -- Keep 12 months of data
    cutoff_date := CURRENT_DATE - INTERVAL '12 months';

    -- Clean up daily activity data
    DELETE FROM daily_activity_data
    WHERE activity_date < cutoff_date;

    GET DIAGNOSTICS activity_deleted = ROW_COUNT;
    RAISE NOTICE 'Cleaned up % daily activity records older than %', activity_deleted, cutoff_date;

    -- Clean up sleep data
    DELETE FROM sleep_data
    WHERE sleep_date < cutoff_date;

    GET DIAGNOSTICS sleep_deleted = ROW_COUNT;
    RAISE NOTICE 'Cleaned up % sleep records older than %', sleep_deleted, cutoff_date;

    -- Clean up coach read-audit log rows (specs/27-coach-health-data-read-audit).
    -- Same 12-month cutoff as the rest of this function; unlike
    -- trainer_actions_audit (write audit, retention forever), read-audit rows
    -- are high-volume and only need to cover a rolling compliance window.
    DELETE FROM client_data_access_log
    WHERE created_at < cutoff_date;

    GET DIAGNOSTICS access_log_deleted = ROW_COUNT;
    RAISE NOTICE 'Cleaned up % client data access log records older than %', access_log_deleted, cutoff_date;

    -- Total deleted count
    deleted_count := activity_deleted + sleep_deleted + access_log_deleted;

    -- Clean up old body measurements (keep all for progress tracking)
    -- Note: Body measurements are kept indefinitely for progress tracking

    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION cleanup_old_health_data() IS 'Removes health data older than 12 months to manage storage: daily_activity_data, sleep_data, and client_data_access_log (coach read-audit, specs/27). Body measurements are kept indefinitely for progress tracking.';
