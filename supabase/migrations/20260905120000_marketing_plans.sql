-- MARKETING-PLANS § WP4. A marketing plan is the admin-only record of one
-- campaign: the brief behind it, the channels it runs on, the referral codes
-- and store offers linked to it, and the off-platform numbers Brad types in by
-- hand. Nothing here is public and nothing here is authoritative over money:
-- App Store Connect owns the offers, Meta owns the spend, and the derived
-- attribution is read from analytics_events / referral_redemptions /
-- founding_grants at query time.
--
-- Additive and idempotent throughout. RLS is enabled with no policies, the
-- convention every admin table in 20260904120000_founding_offer_referrals.sql
-- follows: clients reach these rows only through the core API behind
-- adminGuard, never through PostgREST.

CREATE TABLE IF NOT EXISTS public.marketing_plans (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text NOT NULL,
  slug             text NOT NULL UNIQUE,
  status           text NOT NULL DEFAULT 'draft',
  objective        text,
  hypothesis       text,
  decision_rule    text,
  -- Which rails this plan runs, e.g. {'founding_access','store_offer'}.
  offer_lanes      text[] NOT NULL DEFAULT '{}',
  budget_cap_minor integer,
  currency         text NOT NULL DEFAULT 'GBP',
  starts_on        date,
  ends_on          date,
  -- The brief itself, pasted in as markdown and rendered read-only.
  brief_md         text,
  created_by       uuid NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT marketing_plans_slug_ck   CHECK (slug ~ '^[a-z0-9-]{3,48}$'),
  CONSTRAINT marketing_plans_status_ck CHECK (status IN ('draft', 'active', 'paused', 'complete')),
  CONSTRAINT marketing_plans_budget_ck CHECK (budget_cap_minor IS NULL OR budget_cap_minor >= 0),
  CONSTRAINT marketing_plans_brief_ck  CHECK (brief_md IS NULL OR length(brief_md) <= 65536),
  CONSTRAINT marketing_plans_dates_ck  CHECK (ends_on IS NULL OR starts_on IS NULL OR ends_on >= starts_on)
);

COMMENT ON TABLE public.marketing_plans IS
  'Admin-only marketing plan record. Not public; no RLS policies by design.';

CREATE INDEX IF NOT EXISTS marketing_plans_status_idx
  ON public.marketing_plans (status, created_at DESC);

-- One channel of a plan. `campaign_slug` is deliberately NOT a foreign key:
-- the slug map (CAMPAIGNS in packages/web) is code, not a table, and printed
-- artwork depends on those slugs outliving any row. The shape is constrained
-- instead, and the admin UI validates against the list the API returns.
CREATE TABLE IF NOT EXISTS public.marketing_plan_channels (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id       uuid NOT NULL REFERENCES public.marketing_plans(id) ON DELETE CASCADE,
  campaign_slug text NOT NULL,
  label         text NOT NULL,
  placement     text,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT marketing_plan_channels_slug_ck CHECK (campaign_slug ~ '^[a-z0-9-]{1,32}$'),
  CONSTRAINT marketing_plan_channels_plan_slug_uq UNIQUE (plan_id, campaign_slug)
);

CREATE INDEX IF NOT EXISTS marketing_plan_channels_plan_idx
  ON public.marketing_plan_channels (plan_id);

-- A MIRROR of what was configured in App Store Connect / the Play Console —
-- display and edit only. Price, cap, expiry and eligibility are set there and
-- this milestone does not call the ASC API, so these rows can drift and the UI
-- says so. Never read them as authority for what Apple will charge.
CREATE TABLE IF NOT EXISTS public.marketing_plan_store_offers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id         uuid NOT NULL REFERENCES public.marketing_plans(id) ON DELETE CASCADE,
  platform        text NOT NULL,
  code            text NOT NULL,
  tier_name       text NOT NULL REFERENCES public.subscription_tiers(tier_name),
  duration_months integer NOT NULL,
  price_minor     integer NOT NULL,
  currency        text NOT NULL DEFAULT 'GBP',
  max_redemptions integer,
  expires_on      date,
  campaign_slug   text,
  redemption_url  text,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT marketing_plan_store_offers_platform_ck CHECK (platform IN ('ios', 'android')),
  CONSTRAINT marketing_plan_store_offers_code_ck     CHECK (code ~ '^[A-Z0-9]{3,64}$'),
  CONSTRAINT marketing_plan_store_offers_months_ck   CHECK (duration_months IN (1, 2, 3, 6, 12)),
  CONSTRAINT marketing_plan_store_offers_price_ck    CHECK (price_minor >= 0),
  CONSTRAINT marketing_plan_store_offers_max_ck      CHECK (max_redemptions IS NULL OR max_redemptions >= 0),
  CONSTRAINT marketing_plan_store_offers_slug_ck     CHECK (campaign_slug IS NULL OR campaign_slug ~ '^[a-z0-9-]{1,32}$'),
  CONSTRAINT marketing_plan_store_offers_plan_code_uq UNIQUE (plan_id, platform, code)
);

COMMENT ON TABLE public.marketing_plan_store_offers IS
  'Record of offers configured in App Store Connect / Play Console. Display only — not authoritative.';

CREATE INDEX IF NOT EXISTS marketing_plan_store_offers_plan_idx
  ON public.marketing_plan_store_offers (plan_id);

-- Referral codes linked to a plan, optionally pinned to one of its channels.
-- LINK only: codes are created in /admin → Referral codes and nothing here
-- creates, renames or suggests one.
CREATE TABLE IF NOT EXISTS public.marketing_plan_codes (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id          uuid NOT NULL REFERENCES public.marketing_plans(id) ON DELETE CASCADE,
  referral_code_id uuid NOT NULL REFERENCES public.referral_codes(id),
  campaign_slug    text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT marketing_plan_codes_slug_ck CHECK (campaign_slug IS NULL OR campaign_slug ~ '^[a-z0-9-]{1,32}$'),
  CONSTRAINT marketing_plan_codes_plan_code_uq UNIQUE (plan_id, referral_code_id)
);

CREATE INDEX IF NOT EXISTS marketing_plan_codes_plan_idx
  ON public.marketing_plan_codes (plan_id);
CREATE INDEX IF NOT EXISTS marketing_plan_codes_code_idx
  ON public.marketing_plan_codes (referral_code_id);

-- Off-platform numbers, typed in by hand. Meta spend/impressions/clicks and
-- ASC offer-code redemptions live outside our systems and there is no API pull
-- in this milestone. `campaign_slug` NULL means the row is for the whole plan.
CREATE TABLE IF NOT EXISTS public.marketing_plan_metrics (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id           uuid NOT NULL REFERENCES public.marketing_plans(id) ON DELETE CASCADE,
  campaign_slug     text,
  metric_date       date NOT NULL,
  spend_minor       integer,
  impressions       integer,
  clicks            integer,
  landing_views     integer,
  store_redemptions integer,
  notes             text,
  recorded_by       uuid NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT marketing_plan_metrics_slug_ck CHECK (campaign_slug IS NULL OR campaign_slug ~ '^[a-z0-9-]{1,32}$'),
  CONSTRAINT marketing_plan_metrics_spend_ck CHECK (spend_minor IS NULL OR spend_minor >= 0),
  CONSTRAINT marketing_plan_metrics_impressions_ck CHECK (impressions IS NULL OR impressions >= 0),
  CONSTRAINT marketing_plan_metrics_clicks_ck CHECK (clicks IS NULL OR clicks >= 0),
  CONSTRAINT marketing_plan_metrics_landing_views_ck CHECK (landing_views IS NULL OR landing_views >= 0),
  CONSTRAINT marketing_plan_metrics_redemptions_ck CHECK (store_redemptions IS NULL OR store_redemptions >= 0)
);

CREATE INDEX IF NOT EXISTS marketing_plan_metrics_plan_date_idx
  ON public.marketing_plan_metrics (plan_id, metric_date);

-- The upsert key. A plain UNIQUE (plan_id, campaign_slug, metric_date) cannot
-- be it: NULL is distinct from NULL in a UNIQUE constraint, so every
-- whole-plan row for the same date would be allowed to duplicate — which is
-- exactly the row the weekly form writes most often. COALESCE to a sentinel
-- the CHECK above forbids as a real slug, so plan-level and channel-level rows
-- can never collide either.
CREATE UNIQUE INDEX IF NOT EXISTS marketing_plan_metrics_upsert_uq
  ON public.marketing_plan_metrics (plan_id, (COALESCE(campaign_slug, '*')), metric_date);

-- Service-role only, exactly like the founding/referral tables: every read and
-- write goes through the core API behind adminGuard.
ALTER TABLE public.marketing_plans              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_plan_channels      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_plan_store_offers  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_plan_codes         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_plan_metrics       ENABLE ROW LEVEL SECURITY;
