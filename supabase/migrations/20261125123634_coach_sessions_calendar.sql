-- PER-123 (BE-I2) — Backend design I, migration 10 (sessions half): the coach
-- calendar's bookings and their attendees, plus the athlete push type for
-- them (Linear: "Backend design I — Coach resources and calendar", C4). The
-- resources half of migration 10 is PER-122's own file.
--
-- Additive and idempotent. Re-running it is a no-op; no existing table or
-- column changes.
-- Rollback: supabase/rollbacks/20261125123634_coach_sessions_calendar.sql
--
--   * coach_sessions           — one row per booked occurrence. A weekly
--                                repeat is up to 26 rows sharing series_id,
--                                so each can be moved or cancelled on its own.
--   * coach_session_attendees  — who is booked on a session, through which
--                                coaching relationship, and whether they've
--                                accepted. reminded_at makes the reminder
--                                send once.
--   * notification_type 'coach_session' — the athlete's push for a booking
--     (data.action = booked | moved | cancelled | reminder; Brad, 25 Nov).
--     Not used inside this file, so ADD VALUE inside the migration's
--     transaction is safe (PG12+).
--
-- Assigned workouts stay dateless: only these bookings have times.
-- Both tables are service-role only (RLS on, no policies): they are read and
-- written through the core API, which authorizes explicitly.

-- ─── coach_sessions ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS coach_sessions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trainer_id         uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  kind               text NOT NULL
                       CHECK (kind IN ('in_person', 'video', 'check_in_call', 'own_training')),
  starts_at          timestamptz NOT NULL,
  duration_min       integer NOT NULL CHECK (duration_min BETWEEN 5 AND 720),
  location           text CHECK (location IS NULL OR char_length(location) <= 200),
  -- https only (checked by the API as well).
  video_url          text CHECK (
                       video_url IS NULL
                       OR (char_length(video_url) <= 2000 AND video_url LIKE 'https://%')
                     ),
  -- The workout the session is for. Stays dateless itself.
  workout_id         uuid REFERENCES workouts(id) ON DELETE SET NULL,
  -- Shared by the occurrences of one weekly repeat; NULL for a one-off.
  series_id          uuid,
  notes              text CHECK (notes IS NULL OR char_length(notes) <= 2000),
  -- Minutes before starts_at to remind attendees; NULL = no reminder. At
  -- least 15: the reminder is sent by the 15-minute coach scheduler, so a
  -- shorter one could fall between two runs and never go (C4 shows "2 h").
  reminder_minutes   integer CHECK (reminder_minutes IS NULL OR reminder_minutes BETWEEN 15 AND 10080),
  cancelled_at       timestamptz,
  revision           integer NOT NULL DEFAULT 1,
  client_request_id  text CHECK (client_request_id IS NULL OR char_length(client_request_id) <= 200),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- A replayed create (same Idempotency-Key) returns the first row.
CREATE UNIQUE INDEX IF NOT EXISTS coach_sessions_client_request_uq
  ON coach_sessions (trainer_id, client_request_id);
-- The calendar and Today read a coach's range.
CREATE INDEX IF NOT EXISTS coach_sessions_trainer_starts_idx
  ON coach_sessions (trainer_id, starts_at);
CREATE INDEX IF NOT EXISTS coach_sessions_series_idx
  ON coach_sessions (series_id, starts_at)
  WHERE series_id IS NOT NULL;
-- The reminder sweep only looks at live sessions that want a reminder.
CREATE INDEX IF NOT EXISTS coach_sessions_reminder_due_idx
  ON coach_sessions (starts_at)
  WHERE reminder_minutes IS NOT NULL AND cancelled_at IS NULL;

ALTER TABLE coach_sessions ENABLE ROW LEVEL SECURITY;

-- ─── coach_session_attendees ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS coach_session_attendees (
  session_id       uuid NOT NULL REFERENCES coach_sessions(id) ON DELETE CASCADE,
  client_id        uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  relationship_id  uuid NOT NULL REFERENCES pt_client_relationships(id) ON DELETE CASCADE,
  -- cancelled: taken off the session by the coach, or coaching ended.
  status           text NOT NULL DEFAULT 'invited'
                     CHECK (status IN ('invited', 'accepted', 'declined', 'cancelled')),
  reminded_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, relationship_id)
);

-- The athlete's upcoming sessions and offboarding's cancel.
CREATE INDEX IF NOT EXISTS coach_session_attendees_client_idx
  ON coach_session_attendees (client_id);
CREATE INDEX IF NOT EXISTS coach_session_attendees_relationship_idx
  ON coach_session_attendees (relationship_id);

ALTER TABLE coach_session_attendees ENABLE ROW LEVEL SECURITY;

-- ─── notification type ───────────────────────────────────────────────────────
-- The athlete's booking push. 1.2.0 phones render an unknown type with the
-- generic row (design C D5, checked).
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'coach_session';
