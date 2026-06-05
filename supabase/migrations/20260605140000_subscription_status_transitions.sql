-- Append-only payment-status transition ledger (spec 17 / Phase D, audit
-- LOW-3). The live state lives in mutable `user_subscriptions.payment_status`;
-- this ledger records every transition (and every BLOCKED illegal attempt) so
-- there is a defensible, immutable history for disputes, support, and incident
-- triage — "what happened to this subscription, and when, and why".
--
-- Deliberately NOT foreign-keyed with ON DELETE CASCADE: the audit trail must
-- outlive the row it describes. `user_subscription_id` / `user_id` are plain
-- uuids (logical references). Rows are INSERT-only — never updated or deleted
-- by application code.
--
-- Idempotent: IF NOT EXISTS guards.

CREATE TABLE IF NOT EXISTS subscription_status_transitions (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_subscription_id uuid        NOT NULL,
  user_id              uuid,
  from_status          text,
  to_status            text        NOT NULL,
  -- What drove the transition (e.g. 'webhook:customer.subscription.updated').
  source               text        NOT NULL,
  -- The Stripe event id behind the change, when applicable (forensic link
  -- into stripe_webhook_events.payload).
  stripe_event_id      text,
  -- True when the state machine SUPPRESSED an illegal transition (the row
  -- records the attempt; to_status is what was attempted, the live row kept
  -- from_status).
  blocked              boolean     NOT NULL DEFAULT false,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS subscription_status_transitions_sub_idx
  ON subscription_status_transitions (user_subscription_id, created_at);

COMMENT ON TABLE subscription_status_transitions IS
  'Append-only ledger of user_subscriptions.payment_status transitions (incl. blocked illegal attempts). Insert-only; never updated/deleted. spec 17 / Phase D.';
