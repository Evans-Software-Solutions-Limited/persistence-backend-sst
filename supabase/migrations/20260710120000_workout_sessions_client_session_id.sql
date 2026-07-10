-- M13 (Sync hardening) — make POST /sessions/record replay-safe.
--
-- The mobile offline sync queue retries an ambiguously-failed flush (the
-- server committed the write but the ack was lost to a timeout / dropped
-- connection / app kill). Before this, a retry inserted a SECOND completed
-- session with duplicate exercises/sets. Now the client sends the stable
-- mobile-side session id (the active_sessions local row id) as
-- `client_session_id`, and the repo dedups on (user_id, client_session_id):
-- a retry returns the already-recorded session instead of duplicating it.
--
-- The on-behalf coach record path passes the CLIENT's id as user_id, so this
-- scoping also keeps a coach recording for two different clients from ever
-- colliding.
--
-- client_session_id: nullable text, no default. NULL = legacy client /
-- direct-API caller that supplies no id — those keep the pre-M13 (non-deduped)
-- behaviour. Idempotent: ADD COLUMN IF NOT EXISTS. Backfill: none.
ALTER TABLE workout_sessions
  ADD COLUMN IF NOT EXISTS client_session_id text;

-- Named unique index (matches the Drizzle uniqueIndex name exactly, so the
-- schema mirror and the DB agree and no auto-name drift occurs). NULLs are
-- DISTINCT in a Postgres unique index, so every existing row (client_session_id
-- NULL) is unaffected — uniqueness is enforced only among non-null client ids.
-- This is the constraint the repo's ON CONFLICT DO NOTHING backstop targets.
-- Idempotent: CREATE UNIQUE INDEX IF NOT EXISTS.
CREATE UNIQUE INDEX IF NOT EXISTS workout_sessions_user_client_session_idx
  ON workout_sessions (user_id, client_session_id);
