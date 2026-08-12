-- Growth instrumentation (spec-30 / M20-P1) — `registration_completed` event.
--
-- Profiles are created by a DB trigger (`handle_new_user` on `auth.users`), not
-- by any Node code, and the mobile binary is frozen — so there is no server-side
-- JS at registration time to emit from. This ADDITIVE companion trigger writes
-- the first-party `registration_completed` event straight into analytics_events
-- at the authoritative genuine-registration moment.
--
-- Deliberately a SEPARATE trigger, NOT an edit to `handle_new_user` (which is
-- SECURITY DEFINER and re-defined again in 007) — additive is lower-risk. The
-- name `on_auth_user_created_analytics` sorts AFTER `on_auth_user_created`
-- (prefix ordering), so it fires second and the profiles row (its FK target)
-- already exists in the happy path. Like `handle_new_user`, it swallows all
-- errors so an analytics write can NEVER fail signup (spec-30 HC-2).
--
-- Depends on 20260812120000_analytics_events.sql (runs first by timestamp).
-- Idempotent: CREATE OR REPLACE + DROP TRIGGER IF EXISTS.
-- ⚠ PROD APPLY IS MANUAL (STATE.md).

CREATE OR REPLACE FUNCTION public.emit_registration_event()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.analytics_events (user_id, event_name, source, event_id)
  VALUES (NEW.id, 'registration_completed', 'app', 'reg_' || NEW.id);
  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    -- Never fail signup on an instrumentation write. (A missing profile row —
    -- if handle_new_user itself failed — trips the FK and lands here, which is
    -- correct: a failed registration should not emit registration_completed.)
    RAISE WARNING 'Error emitting registration_completed for user %: % (SQLSTATE: %)',
      NEW.id, SQLERRM, SQLSTATE;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_analytics ON auth.users;
CREATE TRIGGER on_auth_user_created_analytics
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.emit_registration_event();

COMMENT ON FUNCTION public.emit_registration_event() IS
  'spec-30: writes registration_completed into analytics_events after handle_new_user. Error-swallowing; must never fail signup.';
