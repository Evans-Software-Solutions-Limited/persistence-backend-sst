-- spec-29 Phase 1 (task 1.2): per-user AI spend budget, stored in the catalog
-- beside the price it is derived from. A user's AI calls are priced from the
-- shared cost table (packages/subscription-catalog/src/aiCosts.ts) over a
-- rolling 30 days; once the next call would take them past this figure, AI
-- endpoints answer 429 ai_budget_exhausted.
--
-- USD per rolling 30 days. NULL means "no budget configured", which the backend
-- treats as zero (fail closed), never as unlimited.
--
-- Values: spec-29 design § 2 table (2026-08-04), max(3.5 × typical, 33 % of net),
-- capped at 40 % of net. ⚠ PROVISIONAL: Premium+ pricing is being re-audited
-- (PER-103) and Premium loses AI there; update these rows when prices settle.
-- Retired tiers stay NULL. Idempotent.

ALTER TABLE subscription_tiers
  ADD COLUMN IF NOT EXISTS ai_monthly_budget_usd numeric(8, 2);

UPDATE subscription_tiers SET ai_monthly_budget_usd = 0      WHERE tier_name = 'free';
UPDATE subscription_tiers SET ai_monthly_budget_usd = 4.89   WHERE tier_name = 'premium';
UPDATE subscription_tiers SET ai_monthly_budget_usd = 7.26   WHERE tier_name = 'premium_plus';
UPDATE subscription_tiers SET ai_monthly_budget_usd = 5.52   WHERE tier_name = 'individual_trainer';
UPDATE subscription_tiers SET ai_monthly_budget_usd = 8.47   WHERE tier_name = 'start_up_coach_plus';
UPDATE subscription_tiers SET ai_monthly_budget_usd = 14.52  WHERE tier_name = 'coach';
UPDATE subscription_tiers SET ai_monthly_budget_usd = 24.20  WHERE tier_name = 'coach_pro';
