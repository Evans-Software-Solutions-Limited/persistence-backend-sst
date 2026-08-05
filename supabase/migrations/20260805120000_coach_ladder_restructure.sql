-- Coach-ladder restructure — spec-29 Phase 2 (Brad, 2026-08-05).
--
-- Reshapes the IAP catalog into the six-tier ladder the launch bundle sells:
--
--   premium              Premium            £16.99 / £139.99   (consumer)
--   premium_plus         Premium+           £29.99 / £249.99   (consumer, suite)
--   individual_trainer   Start Up Coach     £18.99 / £159.99   (5 clients, NO suite)
--   start_up_coach_plus  Start Up Coach +   £34.99 / £289.99   (5 clients, suite)
--   coach                Coach              £59.99 / £499.99   (15 clients, suite)
--   coach_pro            Coach Pro          £99.99 / £839.99   (30 clients, suite)
--
-- "Suite" = the adaptive-workout suite: Loadout + Mealprint (loadout_access +
-- mealprint_access). Design § 1 / § 2; tasks 2.1–2.4.
--
-- ⚠ tier_name is a plain `text` UNIQUE column, not a Postgres enum (see
-- 004_subscriptions_and_roles.sql), so new tiers are new rows and retired tiers
-- are just flipped inactive — no `ALTER TYPE` step, and no FK breakage.
--
-- ⚠ tier_name is a RevenueCat entitlement id and a `user_subscriptions` FK, so
-- NOTHING here renames a tier_name. `individual_trainer` keeps its id; only its
-- display_name and price move (design § 1). `small_business` / `medium_enterprise`
-- are RETIRED (is_active = false), NOT deleted — kept as tombstones so any lingering
-- FK resolves; the code-side union drops them so nothing can mint them anew. They
-- are replaced on the ladder by `coach` / `coach_pro` (a tier_name change in
-- substance — safe only because of the authorised full prod+staging data reset,
-- 2026-08-04; zero grandfathering).
--
-- ⚠ Every new/repriced tier remains `is_active = false` where it was, and the three
-- NEW coach tiers are seeded `is_active = false` (task 2.2 / 2.9): the paywall
-- renders every active row, so an active row would sell a card whose products do
-- not exist in App Store Connect yet. `is_active` flips in the launch step (2.9),
-- not here. `premium` stays active (it is already live and only reprices).

-- ---------------------------------------------------------------------------
-- 1. individual_trainer → "Start Up Coach": rename display, reprice, and REMOVE
--    the suite. The LIVE row carries loadout_access = true (granted by
--    20260725194527_premium_plus_tier.sql step 3); the new ladder makes the
--    entry rung the NO-suite tier (design § 2, AC 1.3), so this takes it away.
--    mealprint_access is already false on it (premium_plus-only to date).
--    Idempotent: predicate-free UPDATE of a single known row.
-- ---------------------------------------------------------------------------
UPDATE subscription_tiers
SET display_name  = 'Start Up Coach',
    price_monthly = 18.99,
    price_yearly  = 159.99,
    loadout_access = false,
    mealprint_access = false
WHERE tier_name = 'individual_trainer';

-- ---------------------------------------------------------------------------
-- 2. Reprice the two consumer tiers to their FINAL launch prices (D12; task 2.3).
--    Premium moves to £16.99/£139.99 (30 % annual). Premium+ keeps £29.99 monthly
--    and its annual moves £299.99 → £249.99 (30 % annual). is_active untouched:
--    premium stays live, premium_plus stays launch-gated.
-- ---------------------------------------------------------------------------
UPDATE subscription_tiers
SET price_monthly = 16.99, price_yearly = 139.99
WHERE tier_name = 'premium';

UPDATE subscription_tiers
SET price_yearly = 249.99
WHERE tier_name = 'premium_plus';

-- ---------------------------------------------------------------------------
-- 3. Insert the three NEW coach tiers, all suite-bearing, all is_active = false.
--    Client caps mirror Trainerize's 5/15/30 rungs (design § 1). ai_access = true
--    (coach AI summary + Snap/Recipes). loadout_access + mealprint_access = true
--    (the suite). is_trainer_tier = true so the role trigger keeps coach mode.
--    ON CONFLICT DO NOTHING for re-run safety (will NOT correct a pre-existing
--    row with wrong flags — that would be a reviewed hand-run data op, per the
--    precedent in 20260705120000_trainer_tiers_ai_access.sql).
-- ---------------------------------------------------------------------------
INSERT INTO subscription_tiers (
  tier_name, display_name, description, price_monthly, price_yearly, currency,
  workout_limit, ai_access, ai_workout_limit, gym_buddy_access,
  gym_buddy_can_create_workouts, gym_buddy_can_suggest_workouts,
  trainer_client_limit, is_trainer_tier,
  features, analytics_access, export_access,
  loadout_access, mealprint_access, is_active
) VALUES
  (
    'start_up_coach_plus', 'Start Up Coach +',
    'The Start Up Coach plan plus the adaptive suite — Loadout and Mealprint — for you and your clients.',
    34.99, 289.99, 'GBP',
    NULL, true, 30, true, true, true,
    5, true,
    '{"workouts": "unlimited", "progress": true, "loadout": true, "mealprint": true}',
    false, false,
    true, true, false
  ),
  (
    'coach', 'Coach',
    'Coach up to 15 clients, with the full adaptive suite — Loadout and Mealprint.',
    59.99, 499.99, 'GBP',
    NULL, true, 30, true, true, true,
    15, true,
    '{"workouts": "unlimited", "progress": true, "loadout": true, "mealprint": true}',
    false, false,
    true, true, false
  ),
  (
    'coach_pro', 'Coach Pro',
    'Coach up to 30 clients, with the full adaptive suite — Loadout and Mealprint. The top in-app coach plan.',
    99.99, 839.99, 'GBP',
    NULL, true, 30, true, true, true,
    30, true,
    '{"workouts": "unlimited", "progress": true, "loadout": true, "mealprint": true}',
    false, false,
    true, true, false
  )
ON CONFLICT (tier_name) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4. Retire the old business tiers. is_active = false makes them unpurchasable
--    (SubscriptionTiersRepository.listActive filters on it) without deleting the
--    row — so any FK that somehow survived the data reset still resolves. The
--    code-side SubscriptionTierName union drops both names, so no NEW row can be
--    minted under them. Idempotent.
-- ---------------------------------------------------------------------------
UPDATE subscription_tiers
SET is_active = false
WHERE tier_name IN ('small_business', 'medium_enterprise');
