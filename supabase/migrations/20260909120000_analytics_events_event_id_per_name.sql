-- The server-side `Purchase` for a founding web sale never reached Meta, and
-- this index is why.
--
-- `analytics_events_event_id_key` was UNIQUE on `event_id` alone. One founding
-- checkout deliberately reuses ONE id for both of its events — the browser
-- pixel and the server CAPI copy dedupe at Meta on (event_name, event_id), so
-- `checkout_started` and `purchase` share the buyer's id by design. But
-- `AnalyticsEventRepository.insert` pairs this index with
-- `ON CONFLICT DO NOTHING`, so the `purchase` row inserted by the Stripe webhook
-- collided with the `checkout_started` row written half an hour earlier and was
-- silently discarded. No error, no log line: the funnel simply lost every
-- server-side purchase while the browser copy kept firing, which is exactly what
-- Events Manager reported ("Purchase — Meta pixel only").
--
-- Verified on staging 2026-09-09: two founding checkouts completed and created
-- grants, and for both of their event ids `analytics_events` held
-- `checkout_started` and nothing else.
--
-- The fix scopes uniqueness to (event_name, event_id), which is what the
-- idempotency guarantee always meant: a re-run of an at-least-once path (notably
-- the RevenueCat webhook, which emits before mark-done) re-emits the SAME name
-- with the same id and is still deduped, while two DIFFERENT events may share
-- one id. Still partial — rows with a NULL event_id stay exempt and may repeat.
--
-- Strictly a relaxation, so no existing row can violate it and there is nothing
-- to clean up first. Idempotent, and safe to run before or after the old index
-- is gone.

CREATE UNIQUE INDEX IF NOT EXISTS analytics_events_name_event_id_key
  ON analytics_events (event_name, event_id)
  WHERE event_id IS NOT NULL;

DROP INDEX IF EXISTS analytics_events_event_id_key;
