-- PER-117 (BE-C2) — Backend design C, migration 5: coach events, coach
-- notification settings, the scheduler's run ledger and three new
-- notification types (Linear: "Backend design C — Forms, check-ins and coach
-- notifications", D2 and D4).
--
-- Additive and idempotent. Re-running it is a no-op; no existing table or
-- column changes.
-- Rollback: supabase/rollbacks/20261123120117_coach_events_notifications.sql
--
--   * coach_events                 — what happened with a coach's clients: the
--                                    coach's notifications feed and Today queue
--   * coach_notification_settings  — per-coach channel per event kind and quiet
--                                    hours (C6)
--   * coach_scheduler_runs         — coachSchedulerCron's claims, so the same
--                                    15-minute tick (or day, for daily jobs)
--                                    never runs twice
--   * notification_type 'coach_event', 'form_request', 'form_reminder'. Not used
--     inside this file, so ADD VALUE inside the migration's transaction is safe
--     (PG12+).
--
-- All new tables are service-role only (RLS on, no policies): they are read
-- and written through the core API, which authorizes explicitly.

-- ─── coach_events ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS coach_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trainer_id       uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  client_id        uuid REFERENCES profiles(id) ON DELETE CASCADE,
  relationship_id  uuid REFERENCES pt_client_relationships(id) ON DELETE CASCADE,
  -- form_completed, workout_completed, record_hit, form_missed, … Validated in
  -- code, not a CHECK, so adding a kind needs no constraint migration.
  kind             text NOT NULL CHECK (char_length(kind) BETWEEN 1 AND 40),
  entity_type      text CHECK (entity_type IS NULL OR char_length(entity_type) <= 40),
  entity_id        uuid,
  payload          jsonb NOT NULL DEFAULT '{}'::jsonb
                     CHECK (jsonb_typeof(payload) = 'object'),
  occurred_at      timestamptz NOT NULL DEFAULT now(),
  read_at          timestamptz,
  actioned_at      timestamptz,
  -- none: no push wanted (in-app only, or email while email is hidden);
  -- pending: to push now; held: quiet hours, released by the scheduler;
  -- sent: pushed; skipped: the client is muted.
  push_state       text NOT NULL DEFAULT 'none'
                     CHECK (push_state IN ('none', 'pending', 'held', 'sent', 'skipped')),
  dedupe_key       text NOT NULL CHECK (char_length(dedupe_key) BETWEEN 1 AND 200),
  created_at       timestamptz NOT NULL DEFAULT now(),
  -- For the feed's `?since=` (read and actioned marks show up as changes).
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- One event per thing that happened, however many times a writer runs.
CREATE UNIQUE INDEX IF NOT EXISTS coach_events_dedupe_uq
  ON coach_events (trainer_id, dedupe_key);
CREATE INDEX IF NOT EXISTS coach_events_trainer_occurred_idx
  ON coach_events (trainer_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS coach_events_trainer_client_occurred_idx
  ON coach_events (trainer_id, client_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS coach_events_trainer_updated_idx
  ON coach_events (trainer_id, updated_at);
-- The scheduler's push sweeps only ever look at these two states.
CREATE INDEX IF NOT EXISTS coach_events_push_due_idx
  ON coach_events (push_state, occurred_at)
  WHERE push_state IN ('pending', 'held');

ALTER TABLE coach_events ENABLE ROW LEVEL SECURITY;

-- ─── coach_notification_settings (C6) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS coach_notification_settings (
  trainer_id     uuid PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  -- {kind: 'push' | 'email' | 'both' | 'off'}. A missing kind uses its
  -- default. Email is stored but hidden while emailAvailable is false.
  channels       jsonb NOT NULL DEFAULT '{}'::jsonb
                   CHECK (jsonb_typeof(channels) = 'object'),
  quiet_enabled  boolean NOT NULL DEFAULT false,
  -- In the coach's profiles.timezone. from > until wraps midnight.
  quiet_from     time,
  quiet_until    time,
  revision       integer NOT NULL DEFAULT 1,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE coach_notification_settings ENABLE ROW LEVEL SECURITY;

-- ─── coach_scheduler_runs ────────────────────────────────────────────────────
-- A job claims (job, run_key) before it runs: run_key is the 15-minute slot
-- for every-tick jobs and the UTC date for daily ones. The scheduler deletes
-- rows older than 30 days.
CREATE TABLE IF NOT EXISTS coach_scheduler_runs (
  job      text NOT NULL CHECK (char_length(job) BETWEEN 1 AND 60),
  run_key  text NOT NULL CHECK (char_length(run_key) BETWEEN 1 AND 60),
  ran_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (job, run_key)
);

CREATE INDEX IF NOT EXISTS coach_scheduler_runs_ran_at_idx
  ON coach_scheduler_runs (ran_at);

ALTER TABLE coach_scheduler_runs ENABLE ROW LEVEL SECURITY;

-- ─── notification types ──────────────────────────────────────────────────────
-- coach_event: a coach's push about a client (written to the coach's own
-- inbox). form_request / form_reminder: an athlete's form is due. 1.2.0 phones
-- render an unknown type with the generic row (design C D5, checked).
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'coach_event';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'form_request';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'form_reminder';
