-- Admin-only durable refund requests. Match packages/db/src/schema.ts.
-- Rollback (only before use): DROP TABLE IF EXISTS public.founding_refunds;
-- After use, preserve these financial/audit records when rolling back application code.
CREATE TABLE IF NOT EXISTS public.founding_refunds (
  grant_id uuid PRIMARY KEY REFERENCES public.founding_grants(id),
  refund_id text UNIQUE,
  status text NOT NULL DEFAULT 'requested',
  reason text NOT NULL,
  actor_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT founding_refunds_status_ck CHECK
    (status IN ('requested', 'pending', 'requires_action', 'succeeded', 'failed', 'canceled'))
);
ALTER TABLE public.founding_refunds ENABLE ROW LEVEL SECURITY;
-- Access only through the JWT-guarded core API's database role.
REVOKE ALL ON public.founding_refunds FROM anon, authenticated;
