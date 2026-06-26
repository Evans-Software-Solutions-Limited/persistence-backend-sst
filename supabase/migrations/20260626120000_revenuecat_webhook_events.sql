-- RevenueCat webhook event idempotency + lifecycle log.
--
-- The SST webhook handler (POST /revenuecat/webhook) claims every received
-- event by its RevenueCat-assigned `event_id` BEFORE dispatching to the
-- entitlement-sync logic. RevenueCat delivers at-least-once and WITHOUT
-- ordering guarantees, so dedup is non-negotiable — a duplicate delivery must
-- not re-run side effects.
--
-- Mirrors `stripe_webhook_events` (20260520120000) including the durable-claim
-- lifecycle (status: processing | done | failed). Dedup skips only `done`;
-- `failed` and stale `processing` rows are re-claimable so RevenueCat's retry
-- (5/10/20/40/80 min) re-runs a handler that crashed mid-flight.
--
-- `payload` retained as jsonb for forensic debugging / replay. RevenueCat
-- events stay small so the storage cost is trivial. Retention: rows older than
-- 30 days can be pruned out-of-band once past the duplicate-delivery window.
--
-- Idempotent migration: IF NOT EXISTS guards make re-runs no-ops.

CREATE TABLE IF NOT EXISTS revenuecat_webhook_events (
  event_id     text         PRIMARY KEY,
  type         text         NOT NULL,
  processed_at timestamptz  NOT NULL DEFAULT now(),
  payload      jsonb        NOT NULL,
  status       text         NOT NULL DEFAULT 'done',
  attempts     integer      NOT NULL DEFAULT 0,
  last_error   text,
  updated_at   timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS revenuecat_webhook_events_processed_at_idx
  ON revenuecat_webhook_events (processed_at);

COMMENT ON TABLE revenuecat_webhook_events IS
  'Idempotency + lifecycle log for RevenueCat webhook events. Claim by event_id before side effects; dedup skips only done rows.';
