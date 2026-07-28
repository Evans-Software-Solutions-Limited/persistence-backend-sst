-- Client-supplied idempotency keys for workout + exercise creates.
--
-- `POST /sessions/record` has been replay-safe since M13 via
-- `client_session_id` + `workout_sessions_user_client_session_idx`. Nothing else
-- was. An ambiguous failure on a create — a timeout or connection reset that
-- happens AFTER the server has committed — leaves the mobile sync queue unable to
-- tell "not sent" from "sent and committed", so its retry inserted a SECOND row.
-- `useSyncWorker` already refuses to auto-resurrect exhausted creates for exactly
-- this reason, but the ordinary in-budget retry path re-POSTed freely.
--
-- Same shape as the proven `client_session_id` design:
--   * a nullable text column, so every existing row and every legacy/direct-API
--     caller is unaffected (NULLs are distinct in a unique index, so they never
--     conflict with each other);
--   * a unique index scoped to (created_by, client_request_id) — an idempotency
--     key is only meaningful within one account, and scoping it prevents one
--     user's key from colliding with another's;
--   * the handler passes the mobile queue's `Idempotency-Key` header through, and
--     the repository turns a conflict into "return the row that already exists"
--     rather than an error, so a replay is indistinguishable from the original
--     success from the client's point of view.
--
-- Purely additive: safe under migrate-then-deploy (the previous Lambda simply
-- never writes the column). Idempotent: IF NOT EXISTS on both statements.

ALTER TABLE workouts
  ADD COLUMN IF NOT EXISTS client_request_id text;

ALTER TABLE exercises
  ADD COLUMN IF NOT EXISTS client_request_id text;

-- ⚠ FULL indexes, deliberately NOT partial (`WHERE client_request_id IS NOT NULL`).
--
-- A partial index cannot be inferred by `ON CONFLICT (cols) DO NOTHING` unless the
-- statement repeats the index predicate, and Drizzle's
-- `onConflictDoNothing({ target })` emits no predicate — see
-- `drizzle-orm/pg-core/query-builders/insert.js`, which only appends `where` when
-- you pass one explicitly. Postgres then raises 42P10 ("no unique or exclusion
-- constraint matching the ON CONFLICT specification") on EVERY keyed insert, which
-- the drain classifies as transient and retries until the entry is stranded.
--
-- The predicate also bought nothing: NULLs are DISTINCT in a Postgres unique
-- index, so the pre-existing all-NULL rows never conflict with each other under a
-- full index either. This is also why the M13 precedent works —
-- `workout_sessions_user_client_session_idx` (20260710120000) is a full index.
CREATE UNIQUE INDEX IF NOT EXISTS workouts_created_by_client_request_idx
  ON workouts (created_by, client_request_id);

CREATE UNIQUE INDEX IF NOT EXISTS exercises_created_by_client_request_idx
  ON exercises (created_by, client_request_id);
