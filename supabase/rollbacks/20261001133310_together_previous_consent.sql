-- Pre-rollout rollback. Deploy the earlier backend before dropping these columns.
ALTER TABLE "together_participants" DROP COLUMN IF EXISTS "previous_recipient_ids";
ALTER TABLE "together_participants" DROP COLUMN IF EXISTS "previous_consent_version";
