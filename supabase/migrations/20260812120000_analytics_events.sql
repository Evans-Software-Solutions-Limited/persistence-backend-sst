-- Growth instrumentation (spec-30 / M20-P1) — first-party analytics event log.
--
-- Append-only funnel/event store. Server-derived events (registration, trial,
-- purchase, renewal, cancellation, expiration, session_completed, lead_captured)
-- land here best-effort so the installs→registration→trial→paid funnel is
-- computable from this one table joined to profiles/user_subscriptions. It is
-- ALSO the outbox for Meta Conversions API forwarding (see the nightly/5-min
-- `meta-capi-forward` cron): `meta_forwarded_at IS NULL` == not yet sent.
--
-- Privacy (spec-30 HC-4): NO PII at rest. `properties` carries value/currency/
-- audience/tier/store/billing_cycle only — never email or name. Email is
-- SHA-256-hashed in-flight by the CAPI client and never persisted here.
--
-- `user_id` is nullable + ON DELETE SET NULL: a `lead_captured` event has no
-- user, and an account deletion must de-identify (not cascade-wipe) the funnel
-- history that user contributed.
--
-- Idempotent: IF NOT EXISTS throughout, so a re-run is a no-op.
-- ⚠ PROD APPLY IS MANUAL (STATE.md) — staging via deploy, prod by Brad.

CREATE TABLE IF NOT EXISTS analytics_events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid REFERENCES profiles (id) ON DELETE SET NULL,
  event_name        text NOT NULL,
  occurred_at       timestamptz NOT NULL DEFAULT now(),
  properties        jsonb NOT NULL DEFAULT '{}'::jsonb,
  source            text NOT NULL DEFAULT 'server',
  event_id          text,
  meta_forwarded_at timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- Funnel queries: filter/group by event_name over a time window.
CREATE INDEX IF NOT EXISTS analytics_events_name_occurred_idx
  ON analytics_events (event_name, occurred_at);

-- Nightly 12-month retention prune (dataRetentionSweep) scans by created_at.
CREATE INDEX IF NOT EXISTS analytics_events_created_at_idx
  ON analytics_events (created_at);

-- Meta CAPI drainer hot path: the pending set, newest-forwarded first. Partial
-- so the index only carries un-forwarded rows (the forwarded majority drop out).
CREATE INDEX IF NOT EXISTS analytics_events_meta_pending_idx
  ON analytics_events (occurred_at)
  WHERE meta_forwarded_at IS NULL;

-- Idempotency: each logical event carries a stable, globally-unique `event_id`
-- (the RevenueCat event.id, `sess_<id>`, `reg_<userId>`, or the web's UUID), so
-- a re-run of an at-least-once path (notably the RC webhook, which emits before
-- mark-done) can't double-count the funnel. Partial — rows with a NULL event_id
-- (a lead form that sent none) are exempt and may repeat. Paired with
-- `ON CONFLICT DO NOTHING` in AnalyticsEventRepository.insert.
CREATE UNIQUE INDEX IF NOT EXISTS analytics_events_event_id_key
  ON analytics_events (event_id)
  WHERE event_id IS NOT NULL;

COMMENT ON TABLE analytics_events IS
  'spec-30 growth instrumentation: append-only first-party event log + Meta CAPI outbox. No PII at rest (properties never holds email/name).';
