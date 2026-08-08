-- The coach-ladder restructure renamed and repriced `individual_trainer` as
-- Start Up Coach, whose approved catalog contract is five clients. The
-- original forward migration omitted `trainer_client_limit` from its UPDATE,
-- leaving databases upgraded from the legacy catalog at the old two-client
-- cap in both enforcement and customer-facing catalog fields. Correct only
-- that known tier; no subscriptions or account-owned data are touched.
UPDATE subscription_tiers
SET trainer_client_limit = 5,
    description = 'For start-up coaches with up to 5 clients. Includes AI buddy for client insights.',
    features = jsonb_set(features, '{trainer_clients}', '5'::jsonb, true)
WHERE tier_name = 'individual_trainer'
  AND (
    trainer_client_limit IS DISTINCT FROM 5
    OR description IS DISTINCT FROM 'For start-up coaches with up to 5 clients. Includes AI buddy for client insights.'
    OR features -> 'trainer_clients' IS DISTINCT FROM '5'::jsonb
  );
