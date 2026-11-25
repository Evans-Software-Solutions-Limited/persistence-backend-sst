-- PER-122 (BE-I1) — Backend design I, migration 10 (resources part): the
-- coach resources library and its assignments to clients
-- (Linear: "Backend design I — Coach resources and calendar", C3.7, C5b).
--
-- Additive and idempotent. Re-running it is a no-op; no existing table or
-- column changes. The calendar tables of migration 10 (coach_sessions,
-- coach_session_attendees) belong to BE-I2 (PER-123) and are not created here.
-- Rollback: supabase/rollbacks/20261125101829_coach_resources.sql
--
--   * coach_resources            — a coach's library: uploaded files (PDF,
--                                  JPEG, PNG ≤ 25 MB, in the private
--                                  CoachPrivateMedia bucket via private_media)
--                                  and https links
--   * coach_resource_assignments — a resource given to one client on one
--                                  coaching relationship, with opened_at
--
-- Both tables are service-role only (RLS on, no policies): they are read and
-- written through the core API, which authorizes explicitly.

-- ─── coach_resources ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS coach_resources (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trainer_id         uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  kind               text NOT NULL CHECK (kind IN ('file', 'link')),
  title              text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  -- Links only, https only.
  url                text CHECK (url IS NULL OR (char_length(url) BETWEEN 9 AND 2000 AND url LIKE 'https://%')),
  -- Files only: the coach's private_media upload (purpose 'resource').
  media_id           uuid REFERENCES private_media(id) ON DELETE SET NULL,
  mime               text CHECK (mime IS NULL OR mime IN ('application/pdf', 'image/jpeg', 'image/png')),
  bytes              integer CHECK (bytes IS NULL OR bytes BETWEEN 1 AND 26214400),
  archived_at        timestamptz,
  revision           integer NOT NULL DEFAULT 1,
  -- The create's Idempotency-Key: a retried create returns the same resource.
  client_request_id  text CHECK (client_request_id IS NULL OR char_length(client_request_id) BETWEEN 1 AND 200),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT coach_resources_kind_ck CHECK (
    (kind = 'link' AND url IS NOT NULL AND media_id IS NULL)
    OR (kind = 'file' AND url IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS coach_resources_client_request_uq
  ON coach_resources (trainer_id, client_request_id);
CREATE INDEX IF NOT EXISTS coach_resources_trainer_updated_idx
  ON coach_resources (trainer_id, updated_at);

ALTER TABLE coach_resources ENABLE ROW LEVEL SECURITY;

-- ─── coach_resource_assignments ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS coach_resource_assignments (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_id        uuid NOT NULL REFERENCES coach_resources(id) ON DELETE CASCADE,
  trainer_id         uuid NOT NULL,
  client_id          uuid NOT NULL,
  relationship_id    uuid NOT NULL REFERENCES pt_client_relationships(id) ON DELETE CASCADE,
  assigned_at        timestamptz NOT NULL DEFAULT now(),
  -- Stamped once, the first time the athlete opens it.
  opened_at          timestamptz,
  -- Removed by the coach, or by ending coaching. A removed row is history; a
  -- new assignment of the same resource is a new row.
  removed_at         timestamptz,
  client_request_id  text CHECK (client_request_id IS NULL OR char_length(client_request_id) BETWEEN 1 AND 200)
);

-- One live assignment per resource per relationship: bulk assign is
-- idempotent on this index.
CREATE UNIQUE INDEX IF NOT EXISTS coach_resource_assignments_live_uq
  ON coach_resource_assignments (resource_id, relationship_id)
  WHERE removed_at IS NULL;
CREATE INDEX IF NOT EXISTS coach_resource_assignments_relationship_idx
  ON coach_resource_assignments (relationship_id);
CREATE INDEX IF NOT EXISTS coach_resource_assignments_client_idx
  ON coach_resource_assignments (client_id);
CREATE INDEX IF NOT EXISTS coach_resource_assignments_trainer_client_idx
  ON coach_resource_assignments (trainer_id, client_id);

ALTER TABLE coach_resource_assignments ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE coach_resources IS 'Coach resources library: files (private_media) and https links (PER-122, design I). Backend-only: RLS on, no policies.';
COMMENT ON TABLE coach_resource_assignments IS 'A coach resource given to a client on one relationship, with opened_at (PER-122, design I). Backend-only: RLS on, no policies.';
