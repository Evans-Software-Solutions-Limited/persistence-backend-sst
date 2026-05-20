-- Stripe webhook event idempotency log.
--
-- The new SST webhook handler (POST /stripe/webhook) inserts every received
-- event by its Stripe-assigned `event_id` BEFORE dispatching to per-event
-- business logic. The primary-key constraint provides O(1) dedup: a
-- duplicate event arrives → ON CONFLICT DO NOTHING swallows the insert →
-- the handler short-circuits with 200 without re-running side effects.
--
-- Stripe's at-least-once delivery semantics mean dedup is non-negotiable.
-- The legacy Supabase Edge Function had no idempotency; this table closes
-- that gap for the SST handler.
--
-- `payload` retained as jsonb for after-the-fact debugging and replay.
-- Stripe events stay small (< 8KB typical) so the storage cost is trivial.
--
-- Retention: events older than 30 days can be pruned out-of-band — once
-- past the duplicate-delivery window Stripe could realistically replay,
-- the row's only value is forensic. A future cron can DELETE WHERE
-- processed_at < now() - interval '30 days'; the index on processed_at
-- makes that range scan cheap.
--
-- Idempotent migration: IF NOT EXISTS guards make re-runs no-ops.

CREATE TABLE IF NOT EXISTS stripe_webhook_events (
  event_id     text         PRIMARY KEY,
  type         text         NOT NULL,
  processed_at timestamptz  NOT NULL DEFAULT now(),
  payload      jsonb        NOT NULL
);

CREATE INDEX IF NOT EXISTS stripe_webhook_events_processed_at_idx
  ON stripe_webhook_events (processed_at);

COMMENT ON TABLE stripe_webhook_events IS
  'Idempotency log for Stripe webhook events. Insert by event_id before side effects; ON CONFLICT DO NOTHING dedups.';
