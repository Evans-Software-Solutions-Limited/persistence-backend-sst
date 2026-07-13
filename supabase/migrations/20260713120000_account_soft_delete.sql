-- Account deletion — 30-day soft-delete cooling-off (Cluster 2a).
--
-- Two independent changes, both required before the soft-delete flow can ship:
--
-- 1. `profiles.deleted_at` / `profiles.purge_after` — the soft-delete marker.
--    `DELETE /account` now stamps these instead of purging immediately;
--    `POST /account/restore` clears them within the window; the nightly purge
--    worker (specs — Cluster 2a BACKEND_BRIEF Part D) selects
--    `deleted_at IS NOT NULL AND purge_after <= now()` and runs the real
--    purge + auth-user delete at that point. NULL/NULL = never deleted (every
--    existing row, and every newly-created one).
--
-- 2. `program_assignments.assigned_by` — this is a coach's attribution on a
--    CLIENT's row (the client the coach assigned a programme to), so it must
--    NOT be treated like the deleting user's own data (contrast with
--    trainer_actions_audit / client_ai_summaries, which we DELETE outright in
--    accountDeletionPlan.ts). Deleting the coach's account must not delete the
--    client's programme assignment — only detach the attribution. The column
--    was `NOT NULL REFERENCES profiles(id)` with NO ACTION (migration
--    20260703120000_programs_unified_model.sql), which would 500 the whole
--    profile-delete cascade the moment a coach with any programme assignment
--    tried to delete their account (the same crash class as the audit tables,
--    Part A). Made nullable + `ON DELETE SET NULL` so the profile cascade
--    nulls it out and the assignment row survives untouched.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS; the FK swap is guarded on the
-- constraint's CURRENT delete-rule so a re-run (or a run against a database
-- that already has the new shape) is a no-op, never a drop-then-fail.

-- ── 1. profiles soft-delete columns ─────────────────────────────────────────

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS purge_after timestamptz;

COMMENT ON COLUMN profiles.deleted_at IS 'Set by DELETE /account (soft-delete). NULL = active account. Cleared by POST /account/restore within the cooling-off window.';
COMMENT ON COLUMN profiles.purge_after IS 'deleted_at + 30 days. The nightly purge worker hard-deletes the account once now() >= purge_after.';

-- ── 2. program_assignments.assigned_by → nullable + ON DELETE SET NULL ──────

DO $$
DECLARE
  fk_name text;
BEGIN
  -- Locate the FK constraint on program_assignments.assigned_by → profiles.id
  -- by shape rather than assuming Postgres's default
  -- `program_assignments_assigned_by_fkey` name survived unchanged.
  SELECT con.conname INTO fk_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_attribute att
    ON att.attrelid = con.conrelid
   AND att.attnum = ANY (con.conkey)
  WHERE con.contype = 'f'
    AND rel.relname = 'program_assignments'
    AND att.attname = 'assigned_by'
    AND array_length(con.conkey, 1) = 1
  LIMIT 1;

  IF fk_name IS NOT NULL THEN
    -- Only touch it if it isn't ALREADY ON DELETE SET NULL (confdeltype
    -- 'n') — re-running this migration (or applying it to a database that
    -- already has the new shape) must be a no-op, not a drop/recreate churn.
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = fk_name AND confdeltype = 'n'
    ) THEN
      EXECUTE format(
        'ALTER TABLE program_assignments DROP CONSTRAINT %I',
        fk_name
      );
      ALTER TABLE program_assignments ALTER COLUMN assigned_by DROP NOT NULL;
      ALTER TABLE program_assignments
        ADD CONSTRAINT program_assignments_assigned_by_fkey
        FOREIGN KEY (assigned_by) REFERENCES profiles(id) ON DELETE SET NULL;
    END IF;
  ELSE
    -- No FK found at all (defensive — shouldn't happen against the live
    -- schema) but the column may still need to be nullable + constrained.
    ALTER TABLE program_assignments ALTER COLUMN assigned_by DROP NOT NULL;
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'program_assignments_assigned_by_fkey'
    ) THEN
      ALTER TABLE program_assignments
        ADD CONSTRAINT program_assignments_assigned_by_fkey
        FOREIGN KEY (assigned_by) REFERENCES profiles(id) ON DELETE SET NULL;
    END IF;
  END IF;
END $$;

COMMENT ON COLUMN program_assignments.assigned_by IS 'Coach who assigned the programme. Nullable — ON DELETE SET NULL preserves the client''s assignment when the coach''s account is deleted (Cluster 2a); NULL = assigning coach no longer has an account.';
