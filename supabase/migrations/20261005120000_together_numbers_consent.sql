-- Generated from packages/db/src/togetherSchema.ts with Drizzle; rerunnable wrappers added.
ALTER TABLE "together_join_requests" ADD COLUMN IF NOT EXISTS "original_started_at" timestamp with time zone;
ALTER TABLE "together_participants" ADD COLUMN IF NOT EXISTS "numbers_recipient_ids" uuid[] DEFAULT '{}' NOT NULL;
ALTER TABLE "together_participants" ADD COLUMN IF NOT EXISTS "numbers_consent_version" integer DEFAULT 0 NOT NULL;
ALTER TABLE "together_participants" ADD COLUMN IF NOT EXISTS "original_started_at" timestamp with time zone;
ALTER TABLE "together_participants" ADD COLUMN IF NOT EXISTS "removed_from_roster" boolean DEFAULT false NOT NULL;

ALTER TABLE "together_participants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "together_join_requests" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "together_participants", "together_join_requests" FROM PUBLIC, anon, authenticated;
