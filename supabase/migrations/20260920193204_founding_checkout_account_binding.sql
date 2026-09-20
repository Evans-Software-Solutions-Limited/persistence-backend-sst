-- Receipt email and entitlement owner are deliberately independent.
-- No FK: deleting an account must not turn an owned purchase into an anonymous
-- email claim. Retain the original UUID for support/audit and refuse activation.
ALTER TABLE public.founding_checkout_sessions ADD COLUMN IF NOT EXISTS account_id uuid;
CREATE INDEX IF NOT EXISTS founding_checkout_sessions_account_idx
  ON public.founding_checkout_sessions (account_id, status, hold_expires_at);

CREATE OR REPLACE FUNCTION public.preserve_founding_checkout_account() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.account_id IS DISTINCT FROM OLD.account_id THEN
    RAISE EXCEPTION 'Founding checkout account is immutable';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS preserve_founding_checkout_account ON public.founding_checkout_sessions;
CREATE TRIGGER preserve_founding_checkout_account
BEFORE UPDATE ON public.founding_checkout_sessions
FOR EACH ROW EXECUTE FUNCTION public.preserve_founding_checkout_account();
REVOKE ALL ON FUNCTION public.preserve_founding_checkout_account() FROM PUBLIC;

-- Rollback (only after reverting account-bound checkout code; retaining the
-- column is safer once real purchases exist, because it records ownership):
-- DROP TRIGGER IF EXISTS preserve_founding_checkout_account ON public.founding_checkout_sessions;
-- DROP FUNCTION IF EXISTS public.preserve_founding_checkout_account();
-- DROP INDEX IF EXISTS public.founding_checkout_sessions_account_idx;
-- ALTER TABLE public.founding_checkout_sessions DROP COLUMN IF EXISTS account_id;
