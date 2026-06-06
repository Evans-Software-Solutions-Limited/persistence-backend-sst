-- Widen the single-live-subscription guard (spec 17 / Phase A, closes audit
-- HIGH-2).
--
-- The prior partial unique index predicate was ('active','pending'). That
-- left a hole: `trialing` (and `past_due`) were NOT covered, so two
-- concurrent new-trial sign-ups for the same user each inserted a `trialing`
-- row — yielding two live, billable Stripe subscriptions and a double charge
-- at trial end. We widen the predicate to cover every LIVE/billable status.
--
-- Live      = active | pending | trialing | past_due  → at most one per user.
-- Terminal  = cancelled | expired | incomplete_expired → excluded, so a user
--             can always resubscribe after their sub ends.
--
-- Idempotent: DROP ... IF EXISTS + CREATE makes re-runs safe.
--
-- ── PRE-FLIGHT (populated prod DB only) ──────────────────────────────────
-- CREATE UNIQUE INDEX fails if any user already has >1 row in the newly
-- covered set (e.g. a legacy duplicate `trialing` pair from before this
-- guard existed). BEFORE applying to a populated database, run:
--
--   SELECT user_id, count(*) FROM user_subscriptions
--   WHERE payment_status IN ('active','pending','trialing','past_due')
--   GROUP BY user_id HAVING count(*) > 1;
--
-- Resolve any rows returned (keep the latest by created_at; demote the rest
-- to 'cancelled') as a deliberate, reviewed data op — Phase B reconciliation
-- then re-aligns from Stripe truth. We intentionally do NOT auto-demote inside
-- this migration: silently mutating subscription/billing state as a DDL side
-- effect is exactly the kind of money-touching change that must be explicit.

DROP INDEX IF EXISTS user_subscriptions_active_unique;

CREATE UNIQUE INDEX user_subscriptions_active_unique
  ON user_subscriptions (user_id)
  WHERE payment_status IN ('active', 'pending', 'trialing', 'past_due');

COMMENT ON INDEX user_subscriptions_active_unique IS
  'One live subscription per user. Live = active|pending|trialing|past_due. Terminal (cancelled|expired|incomplete_expired) excluded so users can resubscribe. Widened from (active,pending) in spec 17 / Phase A.';
