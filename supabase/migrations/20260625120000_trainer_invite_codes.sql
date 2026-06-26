-- Trainer invite codes — alternative to email-based invitations for clients
-- who hide their email (Apple Sign In "Hide My Email") or for in-person
-- onboarding where the trainer hands the client a short code.
--
-- Flow:
--   1. Trainer generates a code (POST /trainers/me/invite-codes)
--   2. Client enters the code in-app (POST /trainers/accept-invite-code)
--   3. Backend creates the pt_client_relationship directly
--
-- Codes are short (6 alphanumeric chars), expire after 24h, and are
-- single-use. A trainer can have at most one active (unexpired, unused)
-- code at a time to keep the UX simple.

CREATE TABLE IF NOT EXISTS trainer_invite_codes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trainer_id  uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  code        text NOT NULL,
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'used', 'expired')),
  used_by     uuid REFERENCES profiles(id) ON DELETE SET NULL,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Unique on active codes so no two trainers can share the same live code
CREATE UNIQUE INDEX IF NOT EXISTS trainer_invite_codes_code_active_uq
  ON trainer_invite_codes (code)
  WHERE status = 'active';

-- Enforce "at most one active code per trainer" at the DB level (the handler
-- assumes this invariant; without it two concurrent create calls could both
-- insert an active row). A partial unique index on trainer_id WHERE active
-- makes the second concurrent insert fail with 23505, which the handler
-- catches and resolves by returning the already-created active code.
CREATE UNIQUE INDEX IF NOT EXISTS trainer_invite_codes_trainer_active_uq
  ON trainer_invite_codes (trainer_id)
  WHERE status = 'active';

-- Lookup by trainer (dashboard / list active codes)
CREATE INDEX IF NOT EXISTS trainer_invite_codes_trainer_idx
  ON trainer_invite_codes (trainer_id, status);

-- RLS
ALTER TABLE trainer_invite_codes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Trainers can view own invite codes"
  ON trainer_invite_codes FOR SELECT
  TO authenticated
  USING (trainer_id = auth.uid());

CREATE POLICY "Trainers can create invite codes"
  ON trainer_invite_codes FOR INSERT
  TO authenticated
  WITH CHECK (
    trainer_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
      AND role IN ('personal_trainer', 'physiotherapist', 'admin')
    )
  );

CREATE POLICY "Trainers can update own invite codes"
  ON trainer_invite_codes FOR UPDATE
  TO authenticated
  USING (trainer_id = auth.uid());

-- NOTE: deliberately NO broad client-facing SELECT policy. The accept-code
-- flow runs through the SST API on a direct pooler connection (getDb()),
-- which bypasses RLS — so clients never need to read this table via
-- PostgREST. A "status = 'active'" SELECT-for-all policy would let any
-- authenticated user enumerate every trainer's live codes, so it's omitted.

COMMENT ON TABLE trainer_invite_codes IS 'Short-lived invite codes trainers generate for clients to join without email lookup. Single-use, 24h expiry.';
