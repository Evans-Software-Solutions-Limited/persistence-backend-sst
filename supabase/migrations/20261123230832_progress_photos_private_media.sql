-- PER-121 (BE-F1) — Backend design F, migration 8: progress photos and the
-- private media service (Linear: "Backend design F — Progress photos").
--
-- Additive and idempotent. Re-running it is a no-op; no existing table or
-- column changes.
-- Rollback: supabase/rollbacks/20261123230832_progress_photos_private_media.sql
--
--   * progress_photo_sets — one dated set of front, side and back photos
--   * progress_photos     — one row per pose; the object lives in the private
--                           CoachPrivateMedia bucket under s3_key
--   * private_media       — single uploads: form photo answers (design C) and
--                           coach resource files (design I)
--   * private_media_purges — accounts whose bucket objects the account purge
--                           still has to delete (drained nightly)
--
-- The image bytes are never in the database, only the bucket key. All new
-- tables are service-role only (RLS on, no policies): they are read and
-- written through the core API, which authorizes explicitly. Photos are never
-- sent to AI (Brad, 20 Nov 2026).

-- ─── progress_photo_sets ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS progress_photo_sets (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  taken_on           date NOT NULL,
  source             text NOT NULL DEFAULT 'self'
                       CHECK (source IN ('self', 'check_in')),
  -- A set that came from a check-in's photo question (design C).
  form_response_id   uuid REFERENCES coach_form_responses(id) ON DELETE SET NULL,
  -- pending until complete has checked all three objects.
  status             text NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'ready')),
  -- The create's Idempotency-Key: a retried create returns the same set.
  client_request_id  text CHECK (client_request_id IS NULL OR char_length(client_request_id) BETWEEN 1 AND 200),
  created_at         timestamptz NOT NULL DEFAULT now(),
  -- For the list's ?since= (complete and delete are changes).
  updated_at         timestamptz NOT NULL DEFAULT now(),
  -- Tombstone so offline galleries learn about deletes (deletedIds). The
  -- objects and photo rows are removed at delete time.
  deleted_at         timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS progress_photo_sets_client_request_uq
  ON progress_photo_sets (user_id, client_request_id);
CREATE INDEX IF NOT EXISTS progress_photo_sets_user_taken_idx
  ON progress_photo_sets (user_id, taken_on DESC);
CREATE INDEX IF NOT EXISTS progress_photo_sets_user_updated_idx
  ON progress_photo_sets (user_id, updated_at);

ALTER TABLE progress_photo_sets ENABLE ROW LEVEL SECURITY;

-- ─── progress_photos ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS progress_photos (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  set_id      uuid NOT NULL REFERENCES progress_photo_sets(id) ON DELETE CASCADE,
  pose        text NOT NULL CHECK (pose IN ('front', 'side', 'back')),
  s3_key      text NOT NULL CHECK (char_length(s3_key) BETWEEN 1 AND 300),
  -- Declared at create and pinned in the upload link; complete checks the
  -- object's real size against it.
  bytes       integer NOT NULL CHECK (bytes BETWEEN 1 AND 10485760),
  width       integer CHECK (width IS NULL OR width BETWEEN 1 AND 10000),
  height      integer CHECK (height IS NULL OR height BETWEEN 1 AND 10000),
  status      text NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'ready')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS progress_photos_set_pose_uq
  ON progress_photos (set_id, pose);

ALTER TABLE progress_photos ENABLE ROW LEVEL SECURITY;

-- ─── private_media ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS private_media (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id           uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  purpose            text NOT NULL CHECK (purpose IN ('form_answer', 'resource')),
  s3_key             text NOT NULL CHECK (char_length(s3_key) BETWEEN 1 AND 300),
  content_type       text NOT NULL CHECK (char_length(content_type) BETWEEN 1 AND 100),
  bytes              integer NOT NULL CHECK (bytes BETWEEN 1 AND 26214400),
  status             text NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'ready')),
  -- The form response a photo answer was submitted in. Set once, so one
  -- upload can't be attached to two responses, and it is how a coach's view
  -- of a photo answer is checked.
  form_response_id   uuid REFERENCES coach_form_responses(id) ON DELETE SET NULL,
  client_request_id  text CHECK (client_request_id IS NULL OR char_length(client_request_id) BETWEEN 1 AND 200),
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS private_media_client_request_uq
  ON private_media (owner_id, client_request_id);
CREATE INDEX IF NOT EXISTS private_media_owner_created_idx
  ON private_media (owner_id, created_at);
CREATE INDEX IF NOT EXISTS private_media_form_response_idx
  ON private_media (form_response_id)
  WHERE form_response_id IS NOT NULL;
-- The nightly clean-up of uploads never completed.
CREATE INDEX IF NOT EXISTS private_media_pending_idx
  ON private_media (created_at)
  WHERE status = 'pending';

ALTER TABLE private_media ENABLE ROW LEVEL SECURITY;

-- ─── private_media_purges ────────────────────────────────────────────────────
-- The account purge queues a user here BEFORE its SQL purge. A nightly drain
-- deletes the user's objects only once their profile is gone, drops the row
-- if the account was restored instead, and keeps it (retrying) otherwise. No
-- foreign key: the row must outlive the profile it names.
CREATE TABLE IF NOT EXISTS private_media_purges (
  user_id    uuid PRIMARY KEY,
  queued_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE private_media_purges ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE progress_photo_sets IS 'Progress photo sets (PER-121, design F). Private to the athlete and their current coaches (photos switch + photo-sharing consent). Never sent to AI. Backend-only: RLS on, no policies.';
COMMENT ON TABLE progress_photos IS 'One pose of a progress photo set; the JPEG lives in the private CoachPrivateMedia bucket at s3_key. Backend-only: RLS on, no policies.';
COMMENT ON TABLE private_media IS 'Single private uploads: form photo answers and coach resource files (PER-121, designs C/F/I). Backend-only: RLS on, no policies.';
COMMENT ON TABLE private_media_purges IS 'Accounts whose private media objects the nightly purge still has to delete (PER-121). Backend-only: RLS on, no policies.';
