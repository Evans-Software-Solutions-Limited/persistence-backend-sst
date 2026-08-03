-- Mealprint (spec-26) Phase 0 — `subscription_tiers.mealprint_access`.
--
-- The catalog flag the `meal_ai` EntitlementFeature reads. Mirrors
-- `loadout_access` (`20260725194527_premium_plus_tier.sql` step 2) so the
-- catalogue stays the single source of truth for what a tier grants — a future
-- B2B seat tier (M21) becomes a data change rather than a code change, and
-- `assertEntitlement` never hardcodes `tierName === 'premium_plus'`.
--
-- ⚠ **GRANTED TO `premium_plus` ONLY — deliberately NOT to the trainer tiers,
-- which is where this diverges from `loadout_access`.** Three reasons, and the
-- divergence is the considered choice, not an oversight:
--
--   1. Mealprint has NO coach surface in v1. Coach-authored client meal plans
--      are explicitly out of scope (requirements § Out of scope), so unlike
--      Loadout — whose Phase 4 adapts a client's programme and therefore
--      genuinely needs a coach route in — there is nothing for a trainer tier
--      to unlock.
--   2. The `loadout_access`-to-all-trainer-tiers grant created a known,
--      Brad-accepted price hole: a coach gets Loadout at £14.99 while an
--      athlete pays £29.99 for it (STATE.md § Pricing vs AI cost). That was
--      accepted for Loadout because Phase 4 needs it. Repeating it here would
--      widen an acknowledged coherence gap for zero product benefit.
--   3. `individual_trainer` is already the MOST cost-exposed tier in the
--      catalogue at ~212 % of net revenue at saturated ceilings. Mealprint adds
--      ~£7/mo of ceiling-saturated exposure (design § Cost). Granting it there
--      would make the worst tier materially worse to no end.
--
-- A coach who wants Mealprint for their own eating buys Premium+, the same as
-- any athlete. See the matching note on `pickUpgradeTier` in
-- `assertEntitlement.ts` — a `personal_trainer` denied `meal_ai` must be upsold
-- **premium_plus**, not the cheapest trainer tier, or they would pay and stay
-- locked out.
--
-- Additive and backfilled false, so the migrate-then-deploy order is safe and a
-- Lambda running ahead of this file simply never reads the column.
-- ⚠ PRODUCTION APPLY IS MANUAL — flag it in the PR body.

ALTER TABLE subscription_tiers
  ADD COLUMN IF NOT EXISTS mealprint_access boolean NOT NULL DEFAULT false;

-- Plain UPDATE, safe to re-run. `premium_plus` remains `is_active = false`
-- until T-P0.10, so granting the flag here makes the feature reachable for a
-- RevenueCat promotional entitlement (the device-test and comp route) without
-- putting anything on the live paywall.
UPDATE subscription_tiers
SET mealprint_access = true
WHERE tier_name = 'premium_plus';

COMMENT ON COLUMN subscription_tiers.mealprint_access IS 'Mealprint (spec-26 § 3): gates the meal_ai EntitlementFeature. TRUE for premium_plus only — trainer tiers are deliberately excluded (no coach surface in v1; see 20260803120200_mealprint_access.sql for the full rationale).';
