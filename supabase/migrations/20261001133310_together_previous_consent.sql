-- Generated with Drizzle from packages/db/src/togetherSchema.ts; rerunnable wrappers added.
ALTER TABLE "together_participants" ADD COLUMN IF NOT EXISTS "previous_recipient_ids" uuid[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "together_participants" ADD COLUMN IF NOT EXISTS "previous_consent_version" integer DEFAULT 0 NOT NULL;

-- Consent remains behind backend actor/session authorization, never direct Data API access.
ALTER TABLE "together_participants" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "together_participants" FROM PUBLIC, anon, authenticated;
