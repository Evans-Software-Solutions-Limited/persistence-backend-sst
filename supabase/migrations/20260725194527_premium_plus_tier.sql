-- Premium+ tier — M19-P0 (Brad, 2026-07-25).
--
-- Introduces the `premium_plus` catalog row and the `loadout_access` flag
-- that gates the upcoming adaptive-workout suite (Loadout + Mealprint —
-- see specs/21-adaptive-workout-ai/design.md § 9.1). This migration adds
-- the tier + the entitlement COLUMN only; the `loadout` EntitlementFeature
-- gate itself is a later Phase-0 slice, not this one.
--
-- `subscription_tiers.tier_name` is a plain `text` column with a UNIQUE
-- constraint (no Postgres enum backs tier names — see
-- `004_subscriptions_and_roles.sql`), so unlike an enum-backed column this
-- needs no `ALTER TYPE … ADD VALUE` step; a new tier is just a new row.
--
-- 1. Insert the `premium_plus` row. Mirrors `premium`'s gym-buddy /
--    analytics / export flags (same consumer feature set), raises the AI
--    workout allowance to 30/month, and is NOT a trainer tier.
--
--    `ON CONFLICT (tier_name) DO NOTHING` makes the insert idempotent for
--    re-runs, but note it will NOT correct a pre-existing `premium_plus`
--    row that somehow has the wrong price/flags — fixing a bad existing
--    row is a reviewed, hand-run data op (see
--    `20260705120000_trainer_tiers_ai_access.sql` for the precedent of
--    doing that as its own migration), not something this INSERT will
--    silently paper over.
INSERT INTO subscription_tiers (
  tier_name, display_name, description, price_monthly, price_yearly, currency,
  workout_limit, ai_access, ai_workout_limit, gym_buddy_access,
  gym_buddy_can_create_workouts, gym_buddy_can_suggest_workouts,
  trainer_client_limit, is_trainer_tier,
  features, analytics_access, export_access, is_active
) VALUES (
  'premium_plus', 'Premium+',
  'Everything in Premium, plus the adaptive suite: Loadout (adapt any workout or programme to the equipment you actually have) and Mealprint (AI meal planning). 30 AI-generated workouts per month.',
  29.99, 299.99, 'GBP',
  NULL, true, 30, true, true, true,
  NULL, false,
  '{"workouts": "unlimited", "ai_workouts": 30, "gym_buddy": true, "gym_buddy_can_create": true, "gym_buddy_can_suggest": true, "progress": true}',
  true, true, true
)
ON CONFLICT (tier_name) DO NOTHING;

-- 2. `loadout_access` — the entitlement flag the upcoming Loadout feature
--    gate reads. Additive, backfilled false so every existing row (and
--    any row inserted by an out-of-order re-run of this file) defaults to
--    no access until step 3 turns it on for the tiers that should have
--    it.
ALTER TABLE subscription_tiers
  ADD COLUMN IF NOT EXISTS loadout_access boolean NOT NULL DEFAULT false;

-- 3. Grant `loadout_access` to Premium+ and every trainer tier — the
--    adaptive suite is a paid-tier USP same as `ai_access` before it (see
--    `20260526120000_simplify_tier_model.sql` line 17). Plain UPDATE,
--    safe to re-run.
UPDATE subscription_tiers
SET loadout_access = true
WHERE tier_name IN (
  'premium_plus',
  'individual_trainer',
  'small_business',
  'medium_enterprise'
);
