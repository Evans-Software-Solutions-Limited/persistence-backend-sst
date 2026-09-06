-- Founding access is sold on the web again (FOUNDING-OFFER BRIEF § 2,
-- 2026-09-05 amendment): fixed-term, non-renewing access bought through a
-- Stripe Checkout Session in one-off PAYMENT mode.
--
-- This table is the local record of a checkout in flight. It exists for two
-- reasons that Stripe cannot serve on its own:
--
--   1. A SEAT HOLD. Pool capacity is counted from non-revoked `founding`
--      grants, and a grant only exists once payment completes. Without a hold,
--      the last place in the pool could be sold to everyone who happened to be
--      on Stripe's page at the same moment.
--   2. The ATTRIBUTION the webhook needs later — referral code, campaign slug,
--      the Meta click ids and the consent choice — which must survive the
--      round trip to Stripe and back.
--
-- Additive and idempotent. RLS on with no policies: rows hold an email address
-- and are written by the public checkout route through the service role,
-- readable only by the core API.

ALTER TABLE public.founding_grants
  DROP CONSTRAINT IF EXISTS founding_grants_payment_method_ck;
ALTER TABLE public.founding_grants
  ADD CONSTRAINT founding_grants_payment_method_ck
  CHECK (payment_method IN ('bank_transfer', 'stripe_link', 'card_in_person', 'stripe_checkout', 'other'));

CREATE TABLE IF NOT EXISTS public.founding_checkout_sessions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  -- UNIQUE: the webhook is at-least-once, so this is what makes a redelivered
  -- `checkout.session.completed` land on the same row instead of a new one.
  stripe_session_id text NOT NULL UNIQUE,
  email             text NOT NULL,
  tier_name         text NOT NULL REFERENCES public.subscription_tiers(tier_name),
  months            integer NOT NULL,
  amount_minor      integer NOT NULL,
  currency          text NOT NULL DEFAULT 'GBP',
  referral_code     text,
  campaign_slug     text,
  status            text NOT NULL DEFAULT 'open',
  -- Mirrors the Session's own `expires_at`. A hold past this instant counts
  -- for nothing, so a session Stripe has not yet told us about cannot pin a
  -- seat indefinitely.
  hold_expires_at   timestamptz NOT NULL,
  grant_id          uuid REFERENCES public.founding_grants(id) ON DELETE SET NULL,
  -- Meta dedup key + click ids, as the lead routes persist them. None is PII;
  -- forwarding is gated on marketing_consent.
  event_id          text,
  fbc               text,
  fbp               text,
  marketing_consent boolean NOT NULL DEFAULT false,
  CONSTRAINT founding_checkout_sessions_email_lower_ck CHECK (email = lower(email)),
  CONSTRAINT founding_checkout_sessions_months_ck CHECK (months IN (6, 12)),
  CONSTRAINT founding_checkout_sessions_amount_ck CHECK (amount_minor >= 0),
  CONSTRAINT founding_checkout_sessions_status_ck
    CHECK (status IN ('open', 'completed', 'expired', 'refunded')),
  CONSTRAINT founding_checkout_sessions_code_ck
    CHECK (referral_code IS NULL OR referral_code ~ '^[A-Z0-9]{4,24}$'),
  CONSTRAINT founding_checkout_sessions_campaign_ck
    CHECK (campaign_slug IS NULL OR campaign_slug ~ '^[a-z0-9-]{1,32}$')
);

COMMENT ON TABLE public.founding_checkout_sessions IS
  'A founding purchase in flight. An open row holds a pool place until hold_expires_at.';

-- The seat-hold read: open sessions whose hold has not lapsed, by tier.
CREATE INDEX IF NOT EXISTS founding_checkout_sessions_hold_idx
  ON public.founding_checkout_sessions (status, hold_expires_at, tier_name);
CREATE INDEX IF NOT EXISTS founding_checkout_sessions_email_idx
  ON public.founding_checkout_sessions (email);

ALTER TABLE public.founding_checkout_sessions ENABLE ROW LEVEL SECURITY;
