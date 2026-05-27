-- Simplify subscription tier model — drop Basic + Standard trainer variants,
-- rename `_pro` trainer tiers without the suffix.
--
-- Outcome:
--   - Free        (£0 — unchanged)
--   - Premium     (£12.99/mo / £129.99/yr — unchanged)
--   - Individual Trainer            (£14.99 / £149.99 — was individual_trainer_pro)
--   - Small Business Trainer        (£75   / £750   — was small_business_pro)
--   - Medium / Enterprise Trainer   (£300  / £3000  — was medium_enterprise_pro)
--
-- Removed entirely:
--   - basic
--   - individual_trainer_standard
--   - small_business_standard
--   - medium_enterprise_standard
--
-- AI access becomes a paid-tier USP: Premium + any Trainer tier all get AI.
-- See CLAUDE.md "Migration intent" + spec 11 for rationale.
--
-- Idempotent: INSERTs use ON CONFLICT DO NOTHING, UPDATEs/DELETEs are
-- naturally re-runnable.

-- 1. Insert new (no-suffix) tier rows by copying from the corresponding
--    `_pro` rows. Carries all entitlement flags + Stripe price IDs forward.
INSERT INTO subscription_tiers (
  tier_name, display_name, description, price_monthly, price_yearly, currency,
  workout_limit, ai_access, ai_workout_limit, gym_buddy_access,
  gym_buddy_can_create_workouts, gym_buddy_can_suggest_workouts,
  trainer_client_limit, is_trainer_tier,
  features, analytics_access, export_access,
  stripe_price_id_monthly, stripe_price_id_yearly, is_active
)
SELECT
  REPLACE(tier_name, '_pro', ''),
  CASE tier_name
    WHEN 'individual_trainer_pro'  THEN 'Individual Trainer'
    WHEN 'small_business_pro'      THEN 'Small Business Trainer'
    WHEN 'medium_enterprise_pro'   THEN 'Medium / Enterprise Trainer'
  END,
  CASE tier_name
    WHEN 'individual_trainer_pro'
      THEN 'For individual trainers with up to 2 clients. Includes AI buddy for client insights and trainer analytics.'
    WHEN 'small_business_pro'
      THEN 'For small training businesses with up to 30 clients. Includes AI buddy for client insights and trainer analytics.'
    WHEN 'medium_enterprise_pro'
      THEN 'For medium to large training businesses with up to 500 clients. Includes AI buddy for client insights and trainer analytics.'
  END,
  price_monthly, price_yearly, currency,
  workout_limit, ai_access, ai_workout_limit, gym_buddy_access,
  gym_buddy_can_create_workouts, gym_buddy_can_suggest_workouts,
  trainer_client_limit, is_trainer_tier,
  features, analytics_access, export_access,
  stripe_price_id_monthly, stripe_price_id_yearly, is_active
FROM subscription_tiers
WHERE tier_name IN (
  'individual_trainer_pro',
  'small_business_pro',
  'medium_enterprise_pro'
)
ON CONFLICT (tier_name) DO NOTHING;

-- 2. Migrate FK references on user_subscriptions to point at new tier names.
UPDATE user_subscriptions
SET tier_name = REPLACE(tier_name, '_pro', '')
WHERE tier_name IN (
  'individual_trainer_pro',
  'small_business_pro',
  'medium_enterprise_pro'
);

-- 3. Migrate FK references on subscription_price_history to point at new
--    tier names.
UPDATE subscription_price_history
SET tier_name = REPLACE(tier_name, '_pro', '')
WHERE tier_name IN (
  'individual_trainer_pro',
  'small_business_pro',
  'medium_enterprise_pro'
);

-- 4. Now safe to delete the old `_pro` tier rows (no FK refs remain).
DELETE FROM subscription_tiers
WHERE tier_name IN (
  'individual_trainer_pro',
  'small_business_pro',
  'medium_enterprise_pro'
);

-- 5. Delete obsolete tiers (basic + 3 standard).
--    No user_subscriptions on these (verified pre-migration).
--    FK refs on subscription_price_history go first.
DELETE FROM subscription_price_history
WHERE tier_name IN (
  'basic',
  'individual_trainer_standard',
  'small_business_standard',
  'medium_enterprise_standard'
);

DELETE FROM subscription_tiers
WHERE tier_name IN (
  'basic',
  'individual_trainer_standard',
  'small_business_standard',
  'medium_enterprise_standard'
);

-- 6. Confirm Free + Premium display_name (idempotent — these were already
--    the values, but explicitly stating them as the source of truth here).
UPDATE subscription_tiers SET display_name = 'Free' WHERE tier_name = 'free';
UPDATE subscription_tiers SET display_name = 'Premium' WHERE tier_name = 'premium';
