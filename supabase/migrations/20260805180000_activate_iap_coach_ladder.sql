-- Activate the complete IAP ladder now that the app remains safely isolated
-- behind distribution and StoreKit product availability. This is a forward
-- migration because 20260805120000_coach_ladder_restructure.sql has already
-- shipped with the new rows inactive and must not be rewritten.
--
-- The same migration aligns Start Up Coach + annual billing with App Store
-- Connect's supported GBP price point.
UPDATE subscription_tiers
SET is_active = true,
    price_yearly = CASE
      WHEN tier_name = 'start_up_coach_plus' THEN 289.99
      ELSE price_yearly
    END
WHERE tier_name IN (
  'premium',
  'premium_plus',
  'individual_trainer',
  'start_up_coach_plus',
  'coach',
  'coach_pro'
);
