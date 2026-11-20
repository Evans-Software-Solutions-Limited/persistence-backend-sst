-- Rollback for 20261120120000_coaching_relationships_client_profiles.sql (PER-108).
-- Drops only what the migration added. No pre-existing data changes.
--
-- ⚠ Personal codes must go before the general-code index is restored: the old
-- predicate (one active code per trainer) would reject a trainer holding a
-- general code plus a personal one.
DROP TRIGGER IF EXISTS pt_client_relationships_activated_at ON pt_client_relationships;
DROP FUNCTION IF EXISTS set_pt_relationship_activated_at();

DELETE FROM trainer_invite_codes WHERE client_profile_id IS NOT NULL;

-- Restore the client write policies from 20260626110000.
DROP POLICY IF EXISTS "Trainers can create invite codes" ON trainer_invite_codes;
CREATE POLICY "Trainers can create invite codes"
  ON trainer_invite_codes FOR INSERT
  TO authenticated
  WITH CHECK (
    trainer_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
      AND role IN ('personal_trainer', 'physiotherapist', 'admin')
    )
  );
DROP POLICY IF EXISTS "Trainers can update own invite codes" ON trainer_invite_codes;
CREATE POLICY "Trainers can update own invite codes"
  ON trainer_invite_codes FOR UPDATE
  TO authenticated
  USING (trainer_id = auth.uid());
DROP INDEX IF EXISTS trainer_invite_codes_trainer_active_uq;
CREATE UNIQUE INDEX trainer_invite_codes_trainer_active_uq
  ON trainer_invite_codes (trainer_id)
  WHERE status = 'active';
DROP INDEX IF EXISTS trainer_invite_codes_profile_active_uq;
DROP INDEX IF EXISTS trainer_invite_codes_client_request_uq;
ALTER TABLE trainer_invite_codes DROP COLUMN IF EXISTS client_request_id;
ALTER TABLE trainer_invite_codes DROP COLUMN IF EXISTS client_profile_id;

ALTER TABLE pt_client_relationships DROP COLUMN IF EXISTS client_profile_id;
ALTER TABLE pt_client_relationships DROP COLUMN IF EXISTS activated_at;

DROP TABLE IF EXISTS trainer_declarations;
DROP TABLE IF EXISTS coach_client_settings;
DROP TABLE IF EXISTS coach_client_setup_items;
DROP TABLE IF EXISTS coach_client_profiles;
