-- Durable webhook-event claim (spec 17 / Phase B, closes audit MED-2).
--
-- The original model INSERTed an event_id row before dispatch and DELETEd it
-- (`release`) when the handler threw, so Stripe's retry could re-run. The gap:
-- if the handler threw AND the delete also failed (Neon hiccup), the row was
-- stranded and every future retry was silently skipped — the event was lost
-- with nothing to surface it.
--
-- New model: the row is never deleted. It carries a lifecycle status:
--   processing → done            (handled successfully; dedupe future retries)
--   processing → failed          (handler threw; retriable, queryable)
--   failed/stale-processing → processing  (a later retry re-claims it)
--
-- Dedupe is now "skip only if status = 'done'"; a 'failed' or stale
-- 'processing' row is re-claimable so Stripe's retry re-runs it, while a
-- fresh 'processing' row (a concurrent duplicate delivery) is NOT re-claimed.
-- Stranded events stay queryable: `WHERE status <> 'done'`.
--
-- Backfill: existing rows pre-date this column and represent ALREADY-PROCESSED
-- events under the old "row exists = handled" model, so the column DEFAULTs to
-- 'done' — they keep deduping. New inserts set 'processing' explicitly.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.

ALTER TABLE stripe_webhook_events
  ADD COLUMN IF NOT EXISTS status     text        NOT NULL DEFAULT 'done',
  ADD COLUMN IF NOT EXISTS attempts   integer     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Partial index over the small set of not-yet-done rows — makes the
-- "find stranded/failed events" reconciliation query cheap without indexing
-- the (large, append-only) done majority.
CREATE INDEX IF NOT EXISTS stripe_webhook_events_status_idx
  ON stripe_webhook_events (status)
  WHERE status <> 'done';

COMMENT ON COLUMN stripe_webhook_events.status IS
  'Lifecycle: processing | done | failed. Dedupe skips only done. failed / stale-processing rows are re-claimable so Stripe retries re-run them.';
