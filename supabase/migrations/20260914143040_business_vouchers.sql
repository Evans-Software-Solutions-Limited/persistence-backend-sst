-- Server-only vouchers. No bearer voucher/OTP plaintext is persisted.
CREATE TABLE business_voucher_batches (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_name text NOT NULL,
 reference text, tier_name text NOT NULL REFERENCES subscription_tiers(tier_name),
 months integer NOT NULL CHECK (months BETWEEN 1 AND 120),
 allowed_domains text[] NOT NULL DEFAULT '{}', redeem_by timestamptz,
 created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 CHECK (tier_name IN ('premium','premium_plus'))
);
CREATE TABLE business_vouchers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), batch_id uuid NOT NULL REFERENCES business_voucher_batches(id),
 code_hash text NOT NULL UNIQUE, code_hint text NOT NULL, employee_email text,
 revoked_at timestamptz, redeemed_at timestamptz,
 -- Immutable audit identifiers intentionally have NO account/subscription FK:
 -- deletion of an account must never resurrect or erase a purchased voucher.
 account_id uuid, account_email text, eligibility_email text, subscription_id uuid,
 expires_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((redeemed_at IS NULL AND account_id IS NULL AND subscription_id IS NULL) OR
        (redeemed_at IS NOT NULL AND account_id IS NOT NULL AND subscription_id IS NOT NULL AND account_email IS NOT NULL AND eligibility_email IS NOT NULL AND expires_at IS NOT NULL)),
 CHECK (NOT (redeemed_at IS NOT NULL AND revoked_at IS NOT NULL))
);
CREATE INDEX business_vouchers_batch_idx ON business_vouchers(batch_id);
CREATE UNIQUE INDEX business_vouchers_employee_uq ON business_vouchers(batch_id,employee_email) WHERE employee_email IS NOT NULL;
CREATE INDEX business_vouchers_account_idx ON business_vouchers(account_id) WHERE account_id IS NOT NULL;
CREATE TABLE business_voucher_challenges (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), voucher_id uuid NOT NULL REFERENCES business_vouchers(id),
 account_id uuid NOT NULL, account_email text NOT NULL, eligibility_email text NOT NULL,
 otp_hash text, verified_at timestamptz, expires_at timestamptz NOT NULL,
 attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
 completed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX business_voucher_challenges_expiry_idx ON business_voucher_challenges(expires_at) WHERE completed_at IS NULL;
CREATE INDEX business_voucher_challenges_completed_idx ON business_voucher_challenges(completed_at) WHERE completed_at IS NOT NULL;
CREATE TABLE business_voucher_rate_limits (
 key text PRIMARY KEY, attempts integer NOT NULL, resets_at timestamptz NOT NULL
);
CREATE INDEX business_voucher_rate_limits_expiry_idx ON business_voucher_rate_limits(resets_at);
ALTER TABLE business_voucher_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_vouchers ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_voucher_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_voucher_rate_limits ENABLE ROW LEVEL SECURITY;
-- No anon/authenticated policies; backend postgres connection is authoritative.
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
 REVOKE ALL ON business_voucher_batches,business_vouchers,business_voucher_challenges,business_voucher_rate_limits FROM anon;
 END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
 REVOKE ALL ON business_voucher_batches,business_vouchers,business_voucher_challenges,business_voucher_rate_limits FROM authenticated;
 END IF;
END $$;

-- Defence in depth: a consumed voucher is an immutable financial audit record.
CREATE FUNCTION preserve_business_voucher_redemption() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
 IF OLD.redeemed_at IS NOT NULL THEN
   IF TG_OP = 'DELETE' OR NEW IS DISTINCT FROM OLD THEN
     RAISE EXCEPTION 'Redeemed vouchers are immutable' USING ERRCODE = '23514';
   END IF;
 END IF;
 IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER business_voucher_redemption_immutable
BEFORE UPDATE OR DELETE ON business_vouchers
FOR EACH ROW EXECUTE FUNCTION preserve_business_voucher_redemption();
REVOKE ALL ON FUNCTION preserve_business_voucher_redemption() FROM PUBLIC;
