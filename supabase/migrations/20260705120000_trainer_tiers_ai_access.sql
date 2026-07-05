-- Trainer tiers get AI access (Brad, 2026-07-05).
--
-- The 20260526120000_simplify_tier_model migration's stated intent was
-- "AI access becomes a paid-tier USP: Premium + any Trainer tier all get
-- AI", but it only COPIED entitlement flags forward from the legacy
-- `_pro` rows (which carried ai_access = false) rather than setting them.
-- Production was corrected by hand on 2026-07-05; this migration makes
-- the fix reproducible for fresh/staging environments.
--
-- Idempotent: plain UPDATE, safe to re-run.

UPDATE subscription_tiers
SET ai_access = true
WHERE tier_name IN (
  'individual_trainer',
  'small_business',
  'medium_enterprise'
)
  AND is_active = true
  AND ai_access = false;
