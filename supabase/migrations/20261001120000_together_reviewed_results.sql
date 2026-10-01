-- Generated from togetherOfflineSchema.ts with rerunnable DDL and server-only access.
CREATE TABLE IF NOT EXISTS "together_reviewed_results" (
	"user_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"client_record_id" uuid NOT NULL,
	"history_id" uuid,
	"reviewed_revision" integer NOT NULL,
	"completed_at" timestamp with time zone NOT NULL,
	"effects_version" integer DEFAULT 1 NOT NULL,
	"effects_done_version" integer DEFAULT 0 NOT NULL,
	"exercise_definitions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "together_reviewed_results_user_id_session_id_pk" PRIMARY KEY("user_id","session_id")
);

DO $$ BEGIN ALTER TABLE "together_reviewed_results" ADD CONSTRAINT "together_reviewed_results_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "together_reviewed_client_record_idx" ON "together_reviewed_results" USING btree ("user_id","client_record_id");
ALTER TABLE "together_reviewed_results" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "together_reviewed_results" FROM PUBLIC, anon, authenticated;
