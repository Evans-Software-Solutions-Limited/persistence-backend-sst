-- Together backend: server-owned tables; migrate before enabling the feature.
CREATE TABLE IF NOT EXISTS "social_blocks" (
	"actor_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	CONSTRAINT "social_blocks_actor_id_subject_id_pk" PRIMARY KEY("actor_id","subject_id")
);


CREATE TABLE IF NOT EXISTS "social_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"discoverable" boolean DEFAULT false NOT NULL
);


CREATE TABLE IF NOT EXISTS "social_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"context" text NOT NULL,
	"resource_id" uuid,
	"reason" text NOT NULL,
	"details" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);


CREATE TABLE IF NOT EXISTS "social_request_decisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"friend_id" uuid NOT NULL,
	"initiated_by" uuid NOT NULL
);


CREATE TABLE IF NOT EXISTS "together_actors" (
	"user_id" uuid PRIMARY KEY NOT NULL
);


CREATE TABLE IF NOT EXISTS "together_commands" (
	"session_id" uuid NOT NULL,
	"command_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"result" jsonb NOT NULL,
	CONSTRAINT "together_commands_session_id_command_id_pk" PRIMARY KEY("session_id","command_id")
);


CREATE TABLE IF NOT EXISTS "together_connections" (
	"connection_id" text PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked" boolean DEFAULT false NOT NULL
);


CREATE TABLE IF NOT EXISTS "together_events" (
	"session_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"event" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dispatched_at" timestamp with time zone,
	CONSTRAINT "together_events_session_id_revision_pk" PRIMARY KEY("session_id","revision")
);


CREATE TABLE IF NOT EXISTS "together_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"audience" text DEFAULT 'private' NOT NULL,
	"revoked_for" uuid[] DEFAULT '{}' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked" boolean DEFAULT false NOT NULL,
	"consumed" boolean DEFAULT false NOT NULL,
	CONSTRAINT "together_invites_token_hash_unique" UNIQUE("token_hash")
);


CREATE TABLE IF NOT EXISTS "together_jobs" (
	"session_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"client_record_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"effects_done" boolean DEFAULT false NOT NULL,
	CONSTRAINT "together_jobs_session_id_user_id_pk" PRIMARY KEY("session_id","user_id"),
	CONSTRAINT "together_jobs_client_record_id_unique" UNIQUE("client_record_id")
);


CREATE TABLE IF NOT EXISTS "together_join_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"invite_id" uuid,
	"consent_version" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);


CREATE TABLE IF NOT EXISTS "together_participants" (
	"session_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"own_revision" integer DEFAULT 0 NOT NULL,
	"delegation_generation" integer DEFAULT 0 NOT NULL,
	"allow_partner_logging" boolean DEFAULT false NOT NULL,
	"execution" jsonb NOT NULL,
	"exercise_definitions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"frozen_plan" jsonb,
	"consent_version" text NOT NULL,
	"left_at" timestamp with time zone,
	"history_id" uuid,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "together_participants_session_id_user_id_pk" PRIMARY KEY("session_id","user_id")
);


CREATE TABLE IF NOT EXISTS "together_rate_limits" (
	"actor_id" uuid NOT NULL,
	"bucket" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"attempts" integer NOT NULL,
	CONSTRAINT "together_rate_limits_actor_id_bucket_pk" PRIMARY KEY("actor_id","bucket")
);


CREATE TABLE IF NOT EXISTS "together_receipts" (
	"actor_id" uuid NOT NULL,
	"route" text NOT NULL,
	"key" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "together_receipts_actor_id_route_key_pk" PRIMARY KEY("actor_id","route","key")
);


CREATE TABLE IF NOT EXISTS "together_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"host_id" uuid,
	"client_draft_id" uuid NOT NULL,
	"promotion_hash" text NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"plan_version" integer DEFAULT 1 NOT NULL,
	"plan" jsonb NOT NULL,
	"audience" text DEFAULT 'private' NOT NULL,
	"place_id" text,
	"place_label" text,
	"expires_at" timestamp with time zone NOT NULL,
	"collaboration_revoked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);


CREATE TABLE IF NOT EXISTS "together_template_copies" (
	"share_id" uuid NOT NULL,
	"recipient_id" uuid NOT NULL,
	"workout_id" uuid,
	CONSTRAINT "together_template_copies_share_id_recipient_id_pk" PRIMARY KEY("share_id","recipient_id")
);


CREATE TABLE IF NOT EXISTS "together_template_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sender_id" uuid NOT NULL,
	"recipient_id" uuid NOT NULL,
	"plan" jsonb NOT NULL,
	"revoked" boolean DEFAULT false NOT NULL
);


CREATE TABLE IF NOT EXISTS "together_tickets" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used" boolean DEFAULT false NOT NULL
);


DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'social_blocks_actor_id_profiles_id_fk' AND conrelid = 'public.social_blocks'::regclass) THEN
  ALTER TABLE "social_blocks" ADD CONSTRAINT "social_blocks_actor_id_profiles_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
 END IF;
END $$;

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'social_blocks_subject_id_profiles_id_fk' AND conrelid = 'public.social_blocks'::regclass) THEN
  ALTER TABLE "social_blocks" ADD CONSTRAINT "social_blocks_subject_id_profiles_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
 END IF;
END $$;

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'social_profiles_user_id_profiles_id_fk' AND conrelid = 'public.social_profiles'::regclass) THEN
  ALTER TABLE "social_profiles" ADD CONSTRAINT "social_profiles_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
 END IF;
END $$;

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'social_reports_actor_id_profiles_id_fk' AND conrelid = 'public.social_reports'::regclass) THEN
  ALTER TABLE "social_reports" ADD CONSTRAINT "social_reports_actor_id_profiles_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
 END IF;
END $$;

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'social_reports_subject_id_profiles_id_fk' AND conrelid = 'public.social_reports'::regclass) THEN
  ALTER TABLE "social_reports" ADD CONSTRAINT "social_reports_subject_id_profiles_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
 END IF;
END $$;

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'social_request_decisions_user_id_profiles_id_fk' AND conrelid = 'public.social_request_decisions'::regclass) THEN
  ALTER TABLE "social_request_decisions" ADD CONSTRAINT "social_request_decisions_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
 END IF;
END $$;

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'social_request_decisions_friend_id_profiles_id_fk' AND conrelid = 'public.social_request_decisions'::regclass) THEN
  ALTER TABLE "social_request_decisions" ADD CONSTRAINT "social_request_decisions_friend_id_profiles_id_fk" FOREIGN KEY ("friend_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
 END IF;
END $$;

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'social_request_decisions_initiated_by_profiles_id_fk' AND conrelid = 'public.social_request_decisions'::regclass) THEN
  ALTER TABLE "social_request_decisions" ADD CONSTRAINT "social_request_decisions_initiated_by_profiles_id_fk" FOREIGN KEY ("initiated_by") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
 END IF;
END $$;

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'together_actors_user_id_profiles_id_fk' AND conrelid = 'public.together_actors'::regclass) THEN
  ALTER TABLE "together_actors" ADD CONSTRAINT "together_actors_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
 END IF;
END $$;

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'together_commands_session_id_together_sessions_id_fk' AND conrelid = 'public.together_commands'::regclass) THEN
  ALTER TABLE "together_commands" ADD CONSTRAINT "together_commands_session_id_together_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."together_sessions"("id") ON DELETE cascade ON UPDATE no action;
 END IF;
END $$;

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'together_commands_actor_id_profiles_id_fk' AND conrelid = 'public.together_commands'::regclass) THEN
  ALTER TABLE "together_commands" ADD CONSTRAINT "together_commands_actor_id_profiles_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
 END IF;
END $$;

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'together_connections_session_id_together_sessions_id_fk' AND conrelid = 'public.together_connections'::regclass) THEN
  ALTER TABLE "together_connections" ADD CONSTRAINT "together_connections_session_id_together_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."together_sessions"("id") ON DELETE cascade ON UPDATE no action;
 END IF;
END $$;

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'together_connections_user_id_profiles_id_fk' AND conrelid = 'public.together_connections'::regclass) THEN
  ALTER TABLE "together_connections" ADD CONSTRAINT "together_connections_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
 END IF;
END $$;

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'together_events_session_id_together_sessions_id_fk' AND conrelid = 'public.together_events'::regclass) THEN
  ALTER TABLE "together_events" ADD CONSTRAINT "together_events_session_id_together_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."together_sessions"("id") ON DELETE cascade ON UPDATE no action;
 END IF;
END $$;

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'together_invites_session_id_together_sessions_id_fk' AND conrelid = 'public.together_invites'::regclass) THEN
  ALTER TABLE "together_invites" ADD CONSTRAINT "together_invites_session_id_together_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."together_sessions"("id") ON DELETE cascade ON UPDATE no action;
 END IF;
END $$;

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'together_jobs_session_id_together_sessions_id_fk' AND conrelid = 'public.together_jobs'::regclass) THEN
  ALTER TABLE "together_jobs" ADD CONSTRAINT "together_jobs_session_id_together_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."together_sessions"("id") ON DELETE cascade ON UPDATE no action;
 END IF;
END $$;

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'together_jobs_user_id_profiles_id_fk' AND conrelid = 'public.together_jobs'::regclass) THEN
  ALTER TABLE "together_jobs" ADD CONSTRAINT "together_jobs_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
 END IF;
END $$;

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'together_join_requests_session_id_together_sessions_id_fk' AND conrelid = 'public.together_join_requests'::regclass) THEN
  ALTER TABLE "together_join_requests" ADD CONSTRAINT "together_join_requests_session_id_together_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."together_sessions"("id") ON DELETE cascade ON UPDATE no action;
 END IF;
END $$;

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'together_join_requests_user_id_profiles_id_fk' AND conrelid = 'public.together_join_requests'::regclass) THEN
  ALTER TABLE "together_join_requests" ADD CONSTRAINT "together_join_requests_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
 END IF;
END $$;

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'together_join_requests_invite_id_together_invites_id_fk' AND conrelid = 'public.together_join_requests'::regclass) THEN
  ALTER TABLE "together_join_requests" ADD CONSTRAINT "together_join_requests_invite_id_together_invites_id_fk" FOREIGN KEY ("invite_id") REFERENCES "public"."together_invites"("id") ON DELETE no action ON UPDATE no action;
 END IF;
END $$;

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'together_participants_session_id_together_sessions_id_fk' AND conrelid = 'public.together_participants'::regclass) THEN
  ALTER TABLE "together_participants" ADD CONSTRAINT "together_participants_session_id_together_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."together_sessions"("id") ON DELETE cascade ON UPDATE no action;
 END IF;
END $$;

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'together_participants_user_id_profiles_id_fk' AND conrelid = 'public.together_participants'::regclass) THEN
  ALTER TABLE "together_participants" ADD CONSTRAINT "together_participants_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
 END IF;
END $$;

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'together_participants_history_id_workout_sessions_id_fk' AND conrelid = 'public.together_participants'::regclass) THEN
  ALTER TABLE "together_participants" ADD CONSTRAINT "together_participants_history_id_workout_sessions_id_fk" FOREIGN KEY ("history_id") REFERENCES "public"."workout_sessions"("id") ON DELETE set null ON UPDATE no action;
 END IF;
END $$;

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'together_rate_limits_actor_id_profiles_id_fk' AND conrelid = 'public.together_rate_limits'::regclass) THEN
  ALTER TABLE "together_rate_limits" ADD CONSTRAINT "together_rate_limits_actor_id_profiles_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
 END IF;
END $$;

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'together_receipts_actor_id_profiles_id_fk' AND conrelid = 'public.together_receipts'::regclass) THEN
  ALTER TABLE "together_receipts" ADD CONSTRAINT "together_receipts_actor_id_profiles_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
 END IF;
END $$;

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'together_sessions_host_id_profiles_id_fk' AND conrelid = 'public.together_sessions'::regclass) THEN
  ALTER TABLE "together_sessions" ADD CONSTRAINT "together_sessions_host_id_profiles_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;
 END IF;
END $$;

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'together_template_copies_share_id_together_template_shares_id_fk' AND conrelid = 'public.together_template_copies'::regclass) THEN
  ALTER TABLE "together_template_copies" ADD CONSTRAINT "together_template_copies_share_id_together_template_shares_id_fk" FOREIGN KEY ("share_id") REFERENCES "public"."together_template_shares"("id") ON DELETE cascade ON UPDATE no action;
 END IF;
END $$;

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'together_template_copies_recipient_id_profiles_id_fk' AND conrelid = 'public.together_template_copies'::regclass) THEN
  ALTER TABLE "together_template_copies" ADD CONSTRAINT "together_template_copies_recipient_id_profiles_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
 END IF;
END $$;

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'together_template_copies_workout_id_workouts_id_fk' AND conrelid = 'public.together_template_copies'::regclass) THEN
  ALTER TABLE "together_template_copies" ADD CONSTRAINT "together_template_copies_workout_id_workouts_id_fk" FOREIGN KEY ("workout_id") REFERENCES "public"."workouts"("id") ON DELETE set null ON UPDATE no action;
 END IF;
END $$;

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'together_template_shares_sender_id_profiles_id_fk' AND conrelid = 'public.together_template_shares'::regclass) THEN
  ALTER TABLE "together_template_shares" ADD CONSTRAINT "together_template_shares_sender_id_profiles_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
 END IF;
END $$;

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'together_template_shares_recipient_id_profiles_id_fk' AND conrelid = 'public.together_template_shares'::regclass) THEN
  ALTER TABLE "together_template_shares" ADD CONSTRAINT "together_template_shares_recipient_id_profiles_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
 END IF;
END $$;

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'together_tickets_session_id_together_sessions_id_fk' AND conrelid = 'public.together_tickets'::regclass) THEN
  ALTER TABLE "together_tickets" ADD CONSTRAINT "together_tickets_session_id_together_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."together_sessions"("id") ON DELETE cascade ON UPDATE no action;
 END IF;
END $$;

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'together_tickets_user_id_profiles_id_fk' AND conrelid = 'public.together_tickets'::regclass) THEN
  ALTER TABLE "together_tickets" ADD CONSTRAINT "together_tickets_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;
 END IF;
END $$;

CREATE INDEX IF NOT EXISTS "together_connections_session_idx" ON "together_connections" USING btree ("session_id");

CREATE INDEX IF NOT EXISTS "together_events_pending_idx" ON "together_events" USING btree ("created_at") WHERE "together_events"."dispatched_at" is null;

CREATE UNIQUE INDEX IF NOT EXISTS "together_pending_request_idx" ON "together_join_requests" USING btree ("session_id","user_id") WHERE "together_join_requests"."status" = 'pending';

CREATE UNIQUE INDEX IF NOT EXISTS "together_one_unfinished_idx" ON "together_participants" USING btree ("user_id") WHERE "together_participants"."status" in ('active','finalizing');

CREATE UNIQUE INDEX IF NOT EXISTS "together_sessions_promotion_idx" ON "together_sessions" USING btree ("host_id","client_draft_id");

CREATE INDEX IF NOT EXISTS "together_sessions_discovery_idx" ON "together_sessions" USING btree ("audience","expires_at");

ALTER TABLE "social_blocks" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "social_blocks" FROM anon, authenticated;

ALTER TABLE "social_profiles" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "social_profiles" FROM anon, authenticated;

ALTER TABLE "social_reports" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "social_reports" FROM anon, authenticated;

ALTER TABLE "social_request_decisions" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "social_request_decisions" FROM anon, authenticated;

ALTER TABLE "together_actors" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "together_actors" FROM anon, authenticated;

ALTER TABLE "together_commands" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "together_commands" FROM anon, authenticated;

ALTER TABLE "together_connections" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "together_connections" FROM anon, authenticated;

ALTER TABLE "together_events" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "together_events" FROM anon, authenticated;

ALTER TABLE "together_invites" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "together_invites" FROM anon, authenticated;

ALTER TABLE "together_jobs" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "together_jobs" FROM anon, authenticated;

ALTER TABLE "together_join_requests" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "together_join_requests" FROM anon, authenticated;

ALTER TABLE "together_participants" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "together_participants" FROM anon, authenticated;

ALTER TABLE "together_rate_limits" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "together_rate_limits" FROM anon, authenticated;

ALTER TABLE "together_receipts" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "together_receipts" FROM anon, authenticated;

ALTER TABLE "together_sessions" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "together_sessions" FROM anon, authenticated;

ALTER TABLE "together_template_copies" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "together_template_copies" FROM anon, authenticated;

ALTER TABLE "together_template_shares" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "together_template_shares" FROM anon, authenticated;

ALTER TABLE "together_tickets" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "together_tickets" FROM anon, authenticated;
