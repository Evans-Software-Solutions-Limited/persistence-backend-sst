-- Administrative access grants are independent from payment. Existing rows
-- remain founding grants; their legacy payment columns now hold an optional
-- contribution made separately from the entitlement.
ALTER TABLE public.founding_grants
  ADD COLUMN IF NOT EXISTS grant_kind text NOT NULL DEFAULT 'founding';

ALTER TABLE public.founding_grants
  DROP CONSTRAINT IF EXISTS founding_grants_grant_kind_ck;
ALTER TABLE public.founding_grants
  ADD CONSTRAINT founding_grants_grant_kind_ck
  CHECK (grant_kind IN ('founding', 'complimentary'));

ALTER TABLE public.founding_grants
  ALTER COLUMN amount_minor SET DEFAULT 0,
  ALTER COLUMN payment_method DROP NOT NULL,
  ALTER COLUMN paid_at DROP NOT NULL;

-- The original schema allowed a zero-value grant but still required payment
-- method/date fields. Preserve them as founding grants (and therefore keep
-- counting them against their campaign pool), while removing misleading
-- contribution evidence before installing the consistency constraint.
UPDATE public.founding_grants
SET payment_method = NULL,
    payment_reference = NULL,
    paid_at = NULL
WHERE amount_minor = 0;

ALTER TABLE public.founding_grants
  DROP CONSTRAINT IF EXISTS founding_grants_months_ck;
ALTER TABLE public.founding_grants
  ADD CONSTRAINT founding_grants_months_ck CHECK (months BETWEEN 1 AND 120);

ALTER TABLE public.founding_grants
  DROP CONSTRAINT IF EXISTS founding_grants_contribution_ck;
ALTER TABLE public.founding_grants
  ADD CONSTRAINT founding_grants_contribution_ck CHECK (
    (amount_minor = 0 AND payment_method IS NULL AND payment_reference IS NULL AND paid_at IS NULL)
    OR
    (amount_minor > 0 AND payment_method IS NOT NULL AND paid_at IS NOT NULL)
  );

COMMENT ON COLUMN public.founding_grants.amount_minor IS
  'Optional contribution amount in minor units. It does not buy or determine access.';
COMMENT ON COLUMN public.founding_grants.payment_method IS
  'Legacy name: optional contribution method, independent from access.';
COMMENT ON COLUMN public.founding_grants.payment_reference IS
  'Legacy name: optional contribution reference, independent from access.';
COMMENT ON COLUMN public.founding_grants.paid_at IS
  'Legacy name: timestamp of an optional contribution, independent from access.';

CREATE TABLE IF NOT EXISTS public.founding_pool_limits (
  pool text PRIMARY KEY,
  cap integer NOT NULL,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT founding_pool_limits_pool_ck CHECK (pool IN ('consumer', 'coach')),
  CONSTRAINT founding_pool_limits_cap_ck CHECK (cap >= 0)
);

INSERT INTO public.founding_pool_limits (pool, cap)
VALUES ('consumer', 200), ('coach', 20)
ON CONFLICT (pool) DO NOTHING;

ALTER TABLE public.founding_pool_limits ENABLE ROW LEVEL SECURITY;
