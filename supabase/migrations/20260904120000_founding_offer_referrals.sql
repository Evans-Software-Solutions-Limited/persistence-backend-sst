-- FOUNDING-OFFER milestone (specs/milestones/FOUNDING-OFFER/BACKEND_BRIEF.md § 1)
-- Thin slice of spec-32 (partner code & commission platform): referral codes +
-- one-attribution-per-user redemptions, founding-member grants recorded by an
-- admin (payments taken off-app), and an append-only admin audit log.
--
-- Additive + idempotent. Prod apply is automatic via production-deploy.yml.
--
-- A referral code NEVER grants entitlement or changes price (BRIEF D6). A
-- founding grant creates a direct `user_subscriptions` row (BRIEF D3) — this
-- migration only records the grant; the row itself is written by the handler.

CREATE TABLE IF NOT EXISTS referral_codes (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code             text NOT NULL,
  display_code     text NOT NULL,
  label            text NOT NULL,
  partner_name     text,
  kind             text NOT NULL,
  status           text NOT NULL DEFAULT 'active',
  max_redemptions  integer,
  redemption_count integer NOT NULL DEFAULT 0,
  starts_at        timestamptz,
  ends_at          timestamptz,
  campaign_slug    text,
  notes            text,
  created_by       uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT referral_codes_code_uq UNIQUE (code),
  CONSTRAINT referral_codes_code_format_ck CHECK (code ~ '^[A-Z0-9]{4,24}$'),
  CONSTRAINT referral_codes_kind_ck
    CHECK (kind IN ('vendor', 'campaign', 'founding', 'internal')),
  CONSTRAINT referral_codes_status_ck
    CHECK (status IN ('active', 'paused', 'archived')),
  CONSTRAINT referral_codes_max_redemptions_ck
    CHECK (max_redemptions IS NULL OR max_redemptions >= 0),
  CONSTRAINT referral_codes_redemption_count_ck CHECK (redemption_count >= 0)
);

COMMENT ON TABLE referral_codes IS
  'spec-32 slice B: internal referral / partner / campaign codes. Attribution only — never an entitlement.';

CREATE TABLE IF NOT EXISTS referral_redemptions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code_id          uuid NOT NULL REFERENCES referral_codes(id),
  user_id          uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  source           text NOT NULL,
  locked_at        timestamptz,
  replaced_code_id uuid REFERENCES referral_codes(id),
  created_by       uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT referral_redemptions_user_uq UNIQUE (user_id),
  CONSTRAINT referral_redemptions_source_ck
    CHECK (source IN ('app', 'admin', 'web_link'))
);

CREATE INDEX IF NOT EXISTS referral_redemptions_code_id_idx
  ON referral_redemptions (code_id);

COMMENT ON TABLE referral_redemptions IS
  'One attribution per user (BRIEF D5). Replaceable until locked_at (first paid conversion).';

CREATE TABLE IF NOT EXISTS founding_grants (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL while PENDING, or after the linked profile is deleted. Applied grants
  -- are retained for the six-year financial-record period; ON DELETE SET NULL
  -- anonymises the account link without turning them back into pending grants.
  user_id           uuid REFERENCES profiles(id) ON DELETE SET NULL,
  email             text NOT NULL,
  tier_name         text NOT NULL REFERENCES subscription_tiers(tier_name),
  months            integer NOT NULL DEFAULT 6,
  amount_minor      integer NOT NULL,
  currency          text NOT NULL DEFAULT 'GBP',
  payment_method    text NOT NULL,
  payment_reference text,
  paid_at           timestamptz NOT NULL,
  referral_code_id  uuid REFERENCES referral_codes(id),
  subscription_id   uuid REFERENCES user_subscriptions(id) ON DELETE SET NULL,
  -- Immutable issuer UUID: intentionally no profile FK, so deleting the admin
  -- cannot erase or block deletion because of retained financial evidence.
  granted_by        uuid NOT NULL,
  invited_at        timestamptz,
  applied_at        timestamptz,
  revoked_at        timestamptz,
  revoke_reason     text,
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT founding_grants_email_ck CHECK (email = lower(email)),
  CONSTRAINT founding_grants_months_ck CHECK (months > 0),
  CONSTRAINT founding_grants_amount_ck CHECK (amount_minor >= 0),
  CONSTRAINT founding_grants_payment_method_ck
    CHECK (payment_method IN ('bank_transfer', 'stripe_link', 'card_in_person', 'other'))
);

CREATE INDEX IF NOT EXISTS founding_grants_user_id_idx ON founding_grants (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS founding_grants_user_active_uq
  ON founding_grants (user_id) WHERE revoked_at IS NULL AND user_id IS NOT NULL;
-- One live grant per email while it is pending (case-insensitive). Applied
-- grants whose profile was deleted have user_id NULL but applied_at remains set.
CREATE UNIQUE INDEX IF NOT EXISTS founding_grants_email_pending_uq
  ON founding_grants (lower(email)) WHERE revoked_at IS NULL AND applied_at IS NULL;
CREATE INDEX IF NOT EXISTS founding_grants_email_idx ON founding_grants (lower(email));

COMMENT ON TABLE founding_grants IS
  'FOUNDING-OFFER: off-app payment recorded by an admin; links the user_subscriptions row it created.';

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id    uuid NOT NULL,
  action      text NOT NULL,
  entity_type text NOT NULL,
  entity_id   text,
  before      jsonb,
  after       jsonb,
  reason      text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_audit_log_entity_idx
  ON admin_audit_log (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS admin_audit_log_created_at_idx
  ON admin_audit_log (created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS admin_audit_log_founding_apply_deferred_uq
  ON admin_audit_log (action, entity_id)
  WHERE action = 'founding_grant.apply_deferred' AND entity_id IS NOT NULL;

COMMENT ON TABLE admin_audit_log IS
  'Append-only. Every /admin mutation writes a row in the same transaction.';

-- Service-role only: the mobile/web clients reach these tables exclusively
-- through the core API (explicit backend authorisation, no RLS policies).
ALTER TABLE referral_codes       ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_redemptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE founding_grants      ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_audit_log      ENABLE ROW LEVEL SECURITY;
