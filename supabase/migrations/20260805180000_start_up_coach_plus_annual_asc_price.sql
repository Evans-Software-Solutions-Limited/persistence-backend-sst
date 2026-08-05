-- Align Start Up Coach + annual billing with App Store Connect's supported
-- GBP price point. This is intentionally a forward migration because
-- 20260805120000_coach_ladder_restructure.sql may already have run.
UPDATE subscription_tiers
SET price_yearly = 289.99
WHERE tier_name = 'start_up_coach_plus';
