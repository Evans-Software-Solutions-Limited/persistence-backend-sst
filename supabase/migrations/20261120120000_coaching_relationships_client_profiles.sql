-- PER-108 (BE-A1) — Backend design A, migration 1: coaching relationships and
-- client onboarding (Linear: "Backend design A — Coaching relationships and
-- client onboarding", D1).
--
-- Additive and idempotent. Re-running it is a no-op; nothing existing changes
-- meaning. Rollback: supabase/rollbacks/20261120120000_coaching_relationships_client_profiles.sql
--
--   * coach_client_profiles     — the invited client, prepared before accepting
--   * coach_client_setup_items  — what is ready for them (C11l–r)
--   * coach_client_settings     — per-relationship settings (C3.9)
--   * trainer_declarations      — the dated coach declaration (D6b)
--   * trainer_invite_codes.client_profile_id (+ client_request_id)
--   * pt_client_relationships.activated_at, client_profile_id
--   * backfills for activated_at and settings on ACTIVE relationships only
--
-- All new tables are service-role only (RLS on, no policies): they are read
-- and written through the core API, which authorizes explicitly.

-- ─── coach_client_profiles ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS coach_client_profiles (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trainer_id        uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  display_name      text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 80),
  -- For the coach's own use. Persistence sends nothing to these.
  contact_email     text CHECK (contact_email IS NULL OR char_length(contact_email) <= 320),
  contact_phone     text CHECK (contact_phone IS NULL OR char_length(contact_phone) <= 40),
  goal              text CHECK (goal IS NULL OR char_length(goal) <= 200),
  private_notes     text CHECK (private_notes IS NULL OR char_length(private_notes) <= 4000),
  status            text NOT NULL DEFAULT 'invited'
                      CHECK (status IN ('invited', 'active', 'cancelled', 'ended')),
  -- CASCADE, not SET NULL: once the athlete's account is purged, an accepted
  -- profile still holding their name, contact details and the coach's notes
  -- would outlive the erasure (the unaccepted-profile purge skips it).
  client_id         uuid REFERENCES profiles(id) ON DELETE CASCADE,
  relationship_id   uuid REFERENCES pt_client_relationships(id) ON DELETE SET NULL,
  accepted_at       timestamptz,
  cancelled_at      timestamptz,
  -- Tombstone: DELETE hides the row and `?since=` reports it in deletedIds.
  -- The nightly purge removes it for good after 90 days.
  deleted_at        timestamptz,
  revision          integer NOT NULL DEFAULT 1,
  client_request_id text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- A database that ran an earlier draft of this migration has the client_id
-- FK as SET NULL. Re-point it to CASCADE; a no-op re-create otherwise.
ALTER TABLE coach_client_profiles
  DROP CONSTRAINT IF EXISTS coach_client_profiles_client_id_fkey;
ALTER TABLE coach_client_profiles
  ADD CONSTRAINT coach_client_profiles_client_id_fkey
  FOREIGN KEY (client_id) REFERENCES profiles(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS coach_client_profiles_client_request_uq
  ON coach_client_profiles (trainer_id, client_request_id);
CREATE INDEX IF NOT EXISTS coach_client_profiles_trainer_status_idx
  ON coach_client_profiles (trainer_id, status);
CREATE INDEX IF NOT EXISTS coach_client_profiles_relationship_idx
  ON coach_client_profiles (relationship_id);

ALTER TABLE coach_client_profiles ENABLE ROW LEVEL SECURITY;

-- ─── coach_client_setup_items ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS coach_client_setup_items (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id           uuid NOT NULL REFERENCES coach_client_profiles(id) ON DELETE CASCADE,
  section              text NOT NULL CHECK (section IN (
                         'starter_form', 'repeating_form', 'programme',
                         'nutrition_target', 'meal_plan', 'resource',
                         'welcome_message')),
  ref_id               uuid,
  config               jsonb NOT NULL DEFAULT '{}'::jsonb,
  sort_order           integer NOT NULL,
  -- Set once the item has been brought into the client's account on accept,
  -- so materialisation runs exactly once per (relationship, setup item).
  materialised_at      timestamptz,
  materialised_ref_id  uuid,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS coach_client_setup_items_ref_uq
  ON coach_client_setup_items (profile_id, section, ref_id)
  WHERE ref_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS coach_client_setup_items_profile_idx
  ON coach_client_setup_items (profile_id, section, sort_order);

ALTER TABLE coach_client_setup_items ENABLE ROW LEVEL SECURITY;

-- ─── coach_client_settings ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS coach_client_settings (
  relationship_id    uuid PRIMARY KEY REFERENCES pt_client_relationships(id) ON DELETE CASCADE,
  trainer_id         uuid NOT NULL,
  client_id          uuid NOT NULL,
  track_training     boolean NOT NULL DEFAULT false,
  track_calories     boolean NOT NULL DEFAULT false,
  sessions_per_week  smallint CHECK (sessions_per_week IS NULL OR sessions_per_week BETWEEN 1 AND 14),
  -- Keys nutrition, checkIns, photos, habits, messages, resources. A missing
  -- key means on.
  features           jsonb NOT NULL DEFAULT '{}'::jsonb,
  alert_mode         text NOT NULL DEFAULT 'default'
                       CHECK (alert_mode IN ('default', 'mute', 'everything')),
  revision           integer NOT NULL DEFAULT 1,
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS coach_client_settings_trainer_client_idx
  ON coach_client_settings (trainer_id, client_id);
CREATE INDEX IF NOT EXISTS coach_client_settings_client_idx
  ON coach_client_settings (client_id);

ALTER TABLE coach_client_settings ENABLE ROW LEVEL SECURITY;

-- ─── trainer_declarations (append-only, like data_sharing_consents) ──────────
CREATE TABLE IF NOT EXISTS trainer_declarations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trainer_id          uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  statement_version   text NOT NULL CHECK (char_length(statement_version) BETWEEN 1 AND 64),
  statement_text_hash text CHECK (statement_text_hash IS NULL OR statement_text_hash ~ '^[0-9a-f]{64}$'),
  accepted_at         timestamptz NOT NULL DEFAULT now(),
  client_request_id   text
);

CREATE UNIQUE INDEX IF NOT EXISTS trainer_declarations_trainer_version_uq
  ON trainer_declarations (trainer_id, statement_version);
CREATE UNIQUE INDEX IF NOT EXISTS trainer_declarations_client_request_uq
  ON trainer_declarations (trainer_id, client_request_id);

ALTER TABLE trainer_declarations ENABLE ROW LEVEL SECURITY;

-- ─── trainer_invite_codes: personal codes ────────────────────────────────────
ALTER TABLE trainer_invite_codes
  ADD COLUMN IF NOT EXISTS client_profile_id uuid
    REFERENCES coach_client_profiles(id) ON DELETE CASCADE;
-- Offline contract: Idempotency-Key on POST …/client-profiles/:id/invite.
ALTER TABLE trainer_invite_codes
  ADD COLUMN IF NOT EXISTS client_request_id text;

-- One live personal code per profile.
CREATE UNIQUE INDEX IF NOT EXISTS trainer_invite_codes_profile_active_uq
  ON trainer_invite_codes (client_profile_id)
  WHERE status = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS trainer_invite_codes_client_request_uq
  ON trainer_invite_codes (trainer_id, client_request_id);

-- "At most one active code per trainer" now covers GENERAL codes only, so a
-- coach can hold a general code plus one personal code per invited profile.
-- Same index name (the create handler matches on it), predicate loosened —
-- every row the old index accepted is still accepted. Drop + create keeps the
-- migration re-runnable.
DROP INDEX IF EXISTS trainer_invite_codes_trainer_active_uq;
CREATE UNIQUE INDEX trainer_invite_codes_trainer_active_uq
  ON trainer_invite_codes (trainer_id)
  WHERE status = 'active' AND client_profile_id IS NULL;

-- ─── pt_client_relationships ─────────────────────────────────────────────────
ALTER TABLE pt_client_relationships
  ADD COLUMN IF NOT EXISTS activated_at timestamptz;
ALTER TABLE pt_client_relationships
  ADD COLUMN IF NOT EXISTS client_profile_id uuid
    REFERENCES coach_client_profiles(id) ON DELETE SET NULL;

-- activated_at is set whenever status BECOMES active, by every path (coach
-- accept, client accept, personal code). A trigger keeps that true for the
-- existing handlers and DB functions without touching each of them.
CREATE OR REPLACE FUNCTION set_pt_relationship_activated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'active'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'active') THEN
    NEW.activated_at := COALESCE(
      CASE WHEN TG_OP = 'INSERT' THEN NEW.activated_at END,
      now()
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS pt_client_relationships_activated_at
  ON pt_client_relationships;
CREATE TRIGGER pt_client_relationships_activated_at
  BEFORE INSERT OR UPDATE OF status ON pt_client_relationships
  FOR EACH ROW EXECUTE FUNCTION set_pt_relationship_activated_at();

-- ─── Backfills (active relationships only; re-running changes nothing) ──────
UPDATE pt_client_relationships
   SET activated_at = COALESCE(consent_given_at, updated_at, created_at, now())
 WHERE status = 'active'
   AND activated_at IS NULL;

INSERT INTO coach_client_settings (
  relationship_id, trainer_id, client_id,
  track_training, track_calories, sessions_per_week
)
SELECT r.id,
       r.trainer_id,
       r.client_id,
       (prog.days_per_week IS NOT NULL),
       EXISTS (
         SELECT 1 FROM nutrition_targets nt
          WHERE nt.user_id = r.client_id
            AND nt.set_by_user_id = r.trainer_id
       ),
       CASE WHEN prog.days_per_week IS NULL THEN NULL
            ELSE LEAST(GREATEST(prog.days_per_week, 1), 14)::smallint END
  FROM pt_client_relationships r
  LEFT JOIN LATERAL (
    SELECT wp.days_per_week
      FROM program_assignments pa
      JOIN workout_programs wp ON wp.id = pa.program_id
     WHERE pa.client_id = r.client_id
       AND pa.assigned_by = r.trainer_id
       AND pa.status IN ('assigned', 'started')
     ORDER BY pa.created_at DESC NULLS LAST
     LIMIT 1
  ) prog ON true
 WHERE r.status = 'active'
   AND COALESCE(r.is_ai_trainer, false) = false
ON CONFLICT (relationship_id) DO NOTHING;
