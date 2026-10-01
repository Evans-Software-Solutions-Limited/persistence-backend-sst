-- Generated from packages/db/src/togetherOfflineSchema.ts; rerunnable wrappers and server-only access.
CREATE TABLE IF NOT EXISTS "together_offline_commands" (
	"user_id" uuid NOT NULL,
	"command_id" uuid NOT NULL,
	"execution_id" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"revision" integer NOT NULL,
	"command" jsonb NOT NULL,
	CONSTRAINT "together_offline_commands_user_id_command_id_pk" PRIMARY KEY("user_id","command_id")
);

CREATE TABLE IF NOT EXISTS "together_offline_devices" (
	"user_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"public_key" text NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "together_offline_devices_user_id_device_id_pk" PRIMARY KEY("user_id","device_id")
);

CREATE TABLE IF NOT EXISTS "together_offline_executions" (
	"user_id" uuid NOT NULL,
	"execution_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"plan" jsonb NOT NULL,
	"plan_hash" text NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"execution" jsonb NOT NULL,
	CONSTRAINT "together_offline_executions_user_id_execution_id_pk" PRIMARY KEY("user_id","execution_id")
);

DO $$ BEGIN ALTER TABLE "together_offline_commands" ADD CONSTRAINT "together_offline_commands_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "together_offline_devices" ADD CONSTRAINT "together_offline_devices_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "together_offline_executions" ADD CONSTRAINT "together_offline_executions_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE UNIQUE INDEX IF NOT EXISTS "together_offline_execution_revision_idx" ON "together_offline_commands" USING btree ("user_id","execution_id","revision");
CREATE UNIQUE INDEX IF NOT EXISTS "together_offline_owner_session_idx" ON "together_offline_executions" USING btree ("user_id","session_id");
ALTER TABLE "together_offline_devices" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "together_offline_devices" FROM PUBLIC, anon, authenticated;

ALTER TABLE "together_offline_executions" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "together_offline_executions" FROM PUBLIC, anon, authenticated;

ALTER TABLE "together_offline_commands" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "together_offline_commands" FROM PUBLIC, anon, authenticated;
