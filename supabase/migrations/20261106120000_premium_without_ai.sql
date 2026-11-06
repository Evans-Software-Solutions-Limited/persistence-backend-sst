-- PER-103: simplify the athlete ladder. Premium carries no AI; Premium+ carries
-- every AI feature. Decided by Brad, 31 Oct – 5 Nov 2026.
--
--   premium       £4.99 / £39.99   ai_access = false, AI budget 0
--   premium_plus  £24.99 / £199.99 AI budget $4.89 / rolling 30 days
--
-- Premium+'s budget is 40 % of the net a £199.99 App Store annual plan pays per
-- month (VAT 20 %, Apple 30 %, RevenueCat 1 %, £1 = $1.27), the lowest-netting
-- plan on any rail, so the Blue Light Card web prices fit under it too.
--
-- `tier_name` is unchanged: it is the RevenueCat entitlement id and a foreign
-- key from `user_subscriptions`. No live Premium subscriber exists (checked on
-- prod 5 Nov 2026), so nobody loses access they paid for.
--
-- Requires 20261102120000_ai_monthly_budget.sql (adds the budget column).
-- Every statement sets fixed values, so a re-run is a no-op. Manual prod apply,
-- before the backend deploy.

UPDATE subscription_tiers
SET ai_access             = false,
    price_monthly         = 4.99,
    price_yearly          = 39.99,
    ai_monthly_budget_usd = 0,
    description           = 'Unlimited workouts and Train Together with your partners.'
WHERE tier_name = 'premium';

UPDATE subscription_tiers
SET price_monthly         = 24.99,
    price_yearly          = 199.99,
    ai_monthly_budget_usd = 4.89,
    description           = 'Everything in Premium, plus every AI feature: photo and free-text food logging, recipe import, Mealprint and Loadout.'
WHERE tier_name = 'premium_plus';
