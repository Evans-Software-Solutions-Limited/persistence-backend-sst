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
-- 1. Insert the `premium_plus` row.
--
--    SEEDED INACTIVE (`is_active = false`). This is deliberate and is the
--    most important line in the file. `SubscriptionTiersRepository
--    .listActive()` filters on `is_active`, and the M19-P0 paywall rewrite
--    makes both rails render EVERY active non-trainer row — so an active
--    row here would put a buyable £29.99/mo card on the live iOS paywall
--    the moment this migration lands, selling a tier whose only
--    differentiator (Loadout + Mealprint) does not exist yet. A buyer
--    would pay 2.3x Premium's price and receive Premium. The marketing
--    site agrees the tier is not live yet: packages/web Pricing.tsx
--    renders Premium+ as "Coming soon".
--
--    The row still EXISTS, which is what matters for correctness: the
--    `user_subscriptions.tier_name` FK resolves, so a RevenueCat
--    promotional entitlement can be granted and synced before launch
--    without the webhook FK-failing into a retry loop.
--
--    Launch = a one-line `UPDATE subscription_tiers SET is_active = true
--    WHERE tier_name = 'premium_plus';` shipped with the Loadout release.
--
--    Flags: gym-buddy mirrors `premium` (same consumer feature set).
--    `analytics_access` and `export_access` are BOTH FALSE, matching
--    `premium`. Neither feature is built (Brad, 2026-07-25) — nothing in
--    the app or backend gates an analytics screen or an export path on
--    them, and the two paywall bullets they used to drive have been
--    removed. A new billing row must not claim entitlements that do not
--    exist; set them true if and when the features ship. AI workout
--    allowance is raised to 30/month. Not a trainer tier.
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
  'The top athlete plan. Everything in Premium today; the adaptive suite — Loadout and Mealprint — unlocks on this plan when it ships.',
  29.99, 299.99, 'GBP',
  NULL, true, 30, true, true, true,
  NULL, false,
  '{"workouts": "unlimited", "progress": true, "loadout": true, "mealprint": true}',
  false, false, false
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

-- 4. Strip every UNBUILT feature claim from the tier descriptions.
--
--    Brad, 2026-07-25: the only unshipped features we advertise are
--    Loadout and Mealprint. Analytics, data export, "gym buddy" and
--    "AI-generated workouts" are all sold in this column today and NONE
--    of them exist — no analytics screen, no export path, `gym_buddy` is
--    an explicit entitlement stub with no backend surface and no UI, and
--    there is no workout-generation path anywhere in
--    `application/workouts/`.
--
--    This column is not dead copy: `SubscriptionRepository.findForUser`
--    returns it as `tierDescription` and the Profile Drawer renders it
--    verbatim — for every user, including free ones via the synthesised
--    free-tier row — so these claims survive in the product until they are
--    fixed HERE. TypeScript cannot reach them.
--
--    The AI-buddy half of the trainer sentence stays: the AI weekly client
--    summary is real (`POST /trainers/me/clients/:clientId/ai-summary`,
--    rendered in the coach Client Detail screen).
--
--    Idempotent: each statement rewrites to text its own predicate no
--    longer matches, so a re-run is a no-op.

-- 4a. Trainer tiers: drop the analytics claim, keep the AI buddy.
UPDATE subscription_tiers
SET description = regexp_replace(
  description,
  ' and trainer analytics\.$',
  '.'
)
WHERE tier_name IN (
  'individual_trainer',
  'small_business',
  'medium_enterprise'
)
  AND description LIKE '%and trainer analytics.';

-- 4b. Consumer tiers: drop the AI-workout quota and gym-buddy claims.
UPDATE subscription_tiers
SET description = 'Workout and nutrition tracking, with a 3 workout limit.'
WHERE tier_name = 'free'
  AND description LIKE '%gym buddy%';

UPDATE subscription_tiers
SET description = 'Unlimited workouts and history, plus AI nutrition logging from a photo or free text.'
WHERE tier_name = 'premium'
  AND description LIKE '%gym buddy%';
