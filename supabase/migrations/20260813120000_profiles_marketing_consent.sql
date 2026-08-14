-- Growth instrumentation (spec-30 R2.7) — per-user marketing consent.
--
-- Gates whether a user-attributed conversion event may be forwarded to Meta's
-- Conversions API. NULLABLE on purpose: NULL = "never asked" (distinct from an
-- explicit FALSE), and BOTH fail closed — the CAPI drainer forwards a
-- user-attributed row only when this is affirmatively TRUE.
--
-- Nothing writes this today (the marketing website has no sign-up — consent for
-- the live web paths, leads + store clicks, travels in the event's `properties`
-- instead), so it defaults NULL and every user-attributed row fails closed. It
-- exists so the gate is correct-by-construction if a web sign-up / app→web SSO
-- ever produces a user-attributed web event.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS. ⚠ PROD APPLY IS MANUAL (STATE.md).

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS marketing_consent boolean;

COMMENT ON COLUMN profiles.marketing_consent IS
  'spec-30 R2.7: has the user opted in to marketing measurement? NULL = never asked. Gates Meta CAPI forwarding of user-attributed events; NULL/false = no forward (fail closed).';
