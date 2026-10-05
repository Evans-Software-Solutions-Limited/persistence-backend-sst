ALTER TABLE "together_participants" DROP COLUMN IF EXISTS "numbers_recipient_ids";
ALTER TABLE "together_participants" DROP COLUMN IF EXISTS "numbers_consent_version";

ALTER TABLE "together_participants" DROP COLUMN IF EXISTS "removed_from_roster";

ALTER TABLE "together_participants" DROP COLUMN IF EXISTS "original_started_at";
ALTER TABLE "together_join_requests" DROP COLUMN IF EXISTS "original_started_at";
