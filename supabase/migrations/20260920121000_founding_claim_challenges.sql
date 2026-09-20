-- Purchase-email ownership verification for Apple private relay / other account emails.
-- Rollback: DROP TABLE IF EXISTS public.founding_claim_challenges;
CREATE TABLE IF NOT EXISTS public.founding_claim_challenges (
  id uuid PRIMARY KEY,
  grant_id uuid REFERENCES public.founding_grants(id) ON DELETE SET NULL,
  account_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  account_email text NOT NULL,
  purchase_email text NOT NULL,
  otp_hash text,
  attempts integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS founding_claim_challenges_expiry_idx ON public.founding_claim_challenges(expires_at);
CREATE INDEX IF NOT EXISTS founding_claim_challenges_account_idx ON public.founding_claim_challenges(account_id);
ALTER TABLE public.founding_claim_challenges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.founding_claim_challenges FROM anon, authenticated;
