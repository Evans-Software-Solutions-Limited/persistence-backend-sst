-- Trainer actions audit log (specs/10-trainer-features Phase 10.1, cross-cuts § 1.4).
--
-- Every trainer on-behalf write (log a session/measurement for a client, assign
-- a goal/workout, set a nutrition target, add/edit/delete a client note) writes
-- ONE row here, INSIDE the same transaction as the target-row write. The
-- invariant this table exists to enforce: there is never a row carrying a
-- non-NULL `logged_by_user_id` / `assigned_by_user_id` without a matching audit
-- entry (cross-cuts § 1.4.2 — audit-insert failure rolls the whole action back).
--
-- Append-only. Retention: forever (cross-cuts § 1.4.3) — volume is one row per
-- trainer WRITE (not per read), and it backs both client trust ("show me what my
-- trainer did") and compliance ("prove the trainer did / didn't do X").
--
-- Idempotent: enum created only if absent; table + indexes use IF NOT EXISTS.
-- Forward/back safe: a re-run after data exists is a no-op (never drops).

-- ── action_type_enum ─────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'action_type_enum') THEN
    CREATE TYPE action_type_enum AS ENUM (
      'workout_logged_on_behalf',
      'measurement_logged_on_behalf',
      'nutrition_entry_logged_on_behalf',
      'goal_assigned',
      'nutrition_target_set',
      'workout_assigned',
      'client_note_added',
      'client_note_updated',
      'client_note_deleted'
    );
  END IF;
END $$;

-- ── trainer_actions_audit ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS trainer_actions_audit (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trainer_id    uuid NOT NULL REFERENCES profiles(id),
  client_id     uuid NOT NULL REFERENCES profiles(id),
  action_type   action_type_enum NOT NULL,
  target_table  text NOT NULL,
  target_row_id uuid NOT NULL,
  payload       jsonb NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS trainer_actions_audit_client_ts
  ON trainer_actions_audit (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS trainer_actions_audit_trainer_ts
  ON trainer_actions_audit (trainer_id, created_at DESC);

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- Backend-only compliance table. The SST API reaches it via getDb()'s direct
-- pooler connection, which BYPASSES RLS, so NO client-facing policy is needed —
-- and none is wanted: this is an append-only trust/compliance log. Exposing it
-- on Supabase's PostgREST surface would let any `authenticated` user read every
-- trainer's audit trail, or forge / delete rows (defeating "prove the trainer
-- did / didn't do X"). RLS-on + zero policies = closed to PostgREST, open to the
-- backend. Mirrors the trainer_invite_codes precedent (20260626110000) and the
-- repo-wide RLS-on-every-table convention (20260626104105). ENABLE ROW LEVEL
-- SECURITY is idempotent.
ALTER TABLE trainer_actions_audit ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE trainer_actions_audit IS 'Append-only audit of every trainer on-behalf write (cross-cuts § 1.4). Backend-only: RLS on, no policies — reached via the RLS-bypassing pooler connection. Retention: forever.';
