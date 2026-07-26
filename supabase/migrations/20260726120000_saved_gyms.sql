-- Loadout (spec-21) Phase 0 — `saved_gyms`.
--
-- A saved gym is a NAMED SET OF EQUIPMENT belonging to one user ("Hotel gym",
-- "Garage", "PureGym Leeds"). It is the reusable half of Loadout's collect
-- step: instead of re-picking kit every time, the athlete picks a gym and its
-- `equipment_type_ids` become the equipment context for the adaptation
-- (requirements AC-2.1 / US-7).
--
-- This SUPERSEDES `profiles.available_equipment`, which is write-only and
-- unvalidated (never read back by any handler; a test writes the string
-- "dumbbells" into a `uuid[]`). That column is deliberately left in place and
-- still unread — see requirements § Premise correction.
--
-- Idempotent: CREATE TABLE / INDEX IF NOT EXISTS, and ENABLE ROW LEVEL
-- SECURITY is itself idempotent. A re-run after data exists is a no-op and
-- never drops.
--
-- Template: `20260708130000_client_ai_summaries.sql` (create table + named
-- indexes + RLS-on-zero-policies).

CREATE TABLE IF NOT EXISTS saved_gyms (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name               text NOT NULL,
  -- NO array-element FK is possible in Postgres, so validity is enforced in
  -- `SavedGymRepository` — every id must exist in `equipment_types` or the
  -- write is a 400. Same posture as `exercises.equipment_required`, which is
  -- also an unconstrained `uuid[]`.
  equipment_type_ids uuid[] NOT NULL DEFAULT '{}',
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- Per-user name uniqueness (AC-7.4), case- and whitespace-insensitive: "Hotel
-- gym", "hotel gym" and " Hotel Gym " are the same gym. Created as a NAMED
-- unique index rather than an inline UNIQUE constraint so the name matches the
-- Drizzle mirror exactly (an inline UNIQUE auto-names to
-- saved_gyms_user_id_name_key and would drift), and because an inline
-- constraint cannot carry an expression at all.
CREATE UNIQUE INDEX IF NOT EXISTS saved_gyms_user_name_key
  ON saved_gyms (user_id, lower(btrim(name)));

-- Backs the only list query: the caller's gyms, newest first.
CREATE INDEX IF NOT EXISTS saved_gyms_user_created_idx
  ON saved_gyms (user_id, created_at DESC);

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- Backend-only table. The SST API reaches it via getDb()'s pooler connection,
-- which BYPASSES RLS, so no client-facing policy is needed — and none is
-- wanted: exposing this on Supabase's PostgREST surface would let any
-- `authenticated` user read every other user's gyms. RLS-on + zero policies =
-- closed to PostgREST, open to the backend. Mirrors the client_ai_summaries
-- (20260708130000) / trainer_actions_audit (20260705140000) precedent and the
-- repo-wide RLS-on-every-table convention (20260626104105).
ALTER TABLE saved_gyms ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE saved_gyms IS 'Loadout (spec-21): a user''s named equipment sets, used as the equipment context for an adaptation. Backend-only: RLS on, no policies — reached via the RLS-bypassing pooler. Supersedes profiles.available_equipment (write-only, unread).';
