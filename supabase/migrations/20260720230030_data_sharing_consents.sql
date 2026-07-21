-- 26-coach-data-sharing-consent (GO-LIVE BLOCKER) — explicit, recorded, UK
-- GDPR Art 9(2)(a) consent for a coach reading a client's special-category
-- health data (weight, body-fat, measurements, sessions, PRs, nutrition,
-- goals, habits).
--
-- Two pieces:
--
--   1. `data_sharing_consents` — append-only accountability log (Art 5(2)).
--      One row per grant/withdraw event, so the full history survives a
--      re-invite cycle (spec-25 revives the same pt_client_relationships row,
--      so a column alone would lose the history across cycles).
--   2. `pt_client_relationships.consent_given_at` / `.consent_version` — a
--      cheap "is consent currently in force" stamp on the relationship row
--      itself. Set on grant, cleared (NULL) on withdraw/termination — this is
--      what makes "withdraw as easily as granted" true: the existing Leave
--      Coach / Remove Client teardown (25-coach-client-offboarding) clears it
--      in the same transaction as the soft-end.
--
-- No production data exists yet (2026-07-20 decision) — consent is required
-- going forward at the two capture points (email-invite accept, invite-code
-- redeem); there is nothing to backfill or grandfather.
--
-- Idempotent: CREATE TABLE/INDEX IF NOT EXISTS, ADD COLUMN IF NOT EXISTS, a
-- guarded named CHECK constraint. Mirrors 20260705140000_trainer_actions_audit
-- (append-only audit table) and 20260711140000_pt_relationship_initiated_by
-- (nullable stamp columns + guarded CHECK).

-- ── data_sharing_consents ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS data_sharing_consents (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trainer_id       uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  client_id        uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  action           text NOT NULL,
  consent_version  text NOT NULL,
  source           text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'data_sharing_consents_action_check'
  ) THEN
    ALTER TABLE data_sharing_consents
      ADD CONSTRAINT data_sharing_consents_action_check
      CHECK (action IN ('grant', 'withdraw'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS data_sharing_consents_client_trainer_ts
  ON data_sharing_consents (client_id, trainer_id, created_at DESC);

-- Backend-only compliance table — same rationale as trainer_actions_audit:
-- the SST API reaches it via getDb()'s RLS-bypassing pooler connection, so no
-- client-facing PostgREST policy is needed or wanted (append-only trust /
-- compliance log; exposing it would let any `authenticated` user read or
-- forge another user's consent history).
ALTER TABLE data_sharing_consents ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE data_sharing_consents IS 'Append-only log of coach data-sharing consent grant/withdraw events (spec 26, UK GDPR Art 9(2)(a)). Backend-only: RLS on, no policies. Retention: forever.';

-- ── pt_client_relationships: current-consent stamp ──────────────────────────

ALTER TABLE pt_client_relationships
  ADD COLUMN IF NOT EXISTS consent_given_at timestamptz;

ALTER TABLE pt_client_relationships
  ADD COLUMN IF NOT EXISTS consent_version text;
