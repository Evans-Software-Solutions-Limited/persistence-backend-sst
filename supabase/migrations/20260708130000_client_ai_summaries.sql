-- Client AI summaries cache (specs/10-trainer-features Phase 6, design.md § Module g).
--
-- One row per (trainer, client, concluded client-local day). Backs the coach's
-- Client Detail "AI weekly summary" card: the coach gets ONE auto-generated
-- summary per client per concluded day (lazy — spent only when the coach opens
-- that client) plus AT MOST one manual refresh. The UNIQUE(trainer, client,
-- covers_date) constraint IS the once-a-day cap — covers_date only advances when
-- the client's day concludes, so a given day yields exactly one summary row; the
-- manual refresh overwrites that row and bumps refresh_count (blocked at 1).
--
-- This is a CACHE, not client data: the summary is derived from Client Detail
-- modules a–f (per-day totals + adherence — NEVER the food-level entry log,
-- design.md:605-606 privacy line). Reads of this table never trigger inference.
--
-- Idempotent: CREATE TABLE / INDEX IF NOT EXISTS; a re-run after data exists is a
-- no-op (never drops).

CREATE TABLE IF NOT EXISTS client_ai_summaries (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trainer_id    uuid NOT NULL REFERENCES profiles(id),
  client_id     uuid NOT NULL REFERENCES profiles(id),
  covers_date   date NOT NULL,             -- concluded CLIENT-local day (profiles.timezone) the summary describes
  summary       text NOT NULL,
  model         text NOT NULL,             -- resolved AI_COACH_SUMMARY_MODEL_ID
  refresh_count int  NOT NULL DEFAULT 0,   -- 0 = initial lazy gen; 1 = one manual refresh used (caps at 2 inferences/client/day)
  generated_at  timestamptz NOT NULL DEFAULT now()
);

-- The once-a-day cap. Created as a NAMED unique index (not an inline UNIQUE
-- constraint) so the name matches the Drizzle schema's
-- uniqueIndex("client_ai_summaries_trainer_client_date_key") exactly — an
-- inline UNIQUE would auto-name to
-- client_ai_summaries_trainer_id_client_id_covers_date_key and drift from the
-- schema. Also backs onConflictDoNothing's inferred conflict target.
CREATE UNIQUE INDEX IF NOT EXISTS client_ai_summaries_trainer_client_date_key
  ON client_ai_summaries (trainer_id, client_id, covers_date);

CREATE INDEX IF NOT EXISTS client_ai_summaries_trainer_client_date
  ON client_ai_summaries (trainer_id, client_id, covers_date DESC);

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- Backend-only cache table. The SST API reaches it via getDb()'s direct pooler
-- connection, which BYPASSES RLS, so NO client-facing policy is needed — and
-- none is wanted: exposing it on Supabase's PostgREST surface would let any
-- `authenticated` user read every trainer's AI summaries of every client.
-- RLS-on + zero policies = closed to PostgREST, open to the backend. Mirrors the
-- trainer_actions_audit (20260705140000) / trainer_invite_codes (20260626110000)
-- precedent and the repo-wide RLS-on-every-table convention (20260626104105).
-- ENABLE ROW LEVEL SECURITY is idempotent.
ALTER TABLE client_ai_summaries ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE client_ai_summaries IS 'Per-(trainer,client,concluded-day) cache of the coach AI Client Summary (design.md § Module g). Backend-only: RLS on, no policies — reached via the RLS-bypassing pooler. One auto-gen + one manual refresh per day (refresh_count caps at 1).';
