-- Migration: Sync Exercises to Algolia Trigger
-- Creates a trigger that automatically syncs exercises to Algolia when they are created, updated, or deleted
-- Uses app.settings table (same pattern as push notifications) for configuration

-- Enable pg_net extension for HTTP calls (if not already enabled)
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Ensure app.settings table exists (created by migration 011_app_settings_for_push_notifications.sql)
-- This is a no-op if the table already exists
CREATE SCHEMA IF NOT EXISTS app;

CREATE TABLE IF NOT EXISTS app.settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    description TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Function to sync exercise to Algolia via Edge Function
CREATE OR REPLACE FUNCTION sync_exercise_to_algolia()
RETURNS TRIGGER AS $$
DECLARE
  action_type TEXT;
  exercise_id_val UUID;
  supabase_url TEXT;
  service_role_key TEXT;
BEGIN
  -- Determine action type
  IF TG_OP = 'DELETE' THEN
    action_type := 'delete';
    exercise_id_val := OLD.id;
  ELSE
    action_type := CASE WHEN TG_OP = 'INSERT' THEN 'create' ELSE 'update' END;
    exercise_id_val := NEW.id;
  END IF;

  -- Get Supabase URL and service role key from app.settings table
  -- Same pattern as push notification trigger (migration 011)
  SELECT 
    (SELECT value FROM app.settings WHERE key = 'supabase_url'),
    (SELECT value FROM app.settings WHERE key = 'service_role_key')
  INTO supabase_url, service_role_key;

  -- If settings not configured, skip Algolia sync
  IF supabase_url IS NULL OR supabase_url = '' THEN
    RAISE WARNING 'Supabase URL not configured in app.settings. Skipping Algolia sync.';
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    ELSE
      RETURN NEW;
    END IF;
  END IF;

  IF service_role_key IS NULL OR service_role_key = '' THEN
    RAISE WARNING 'Service role key not configured in app.settings. Skipping Algolia sync.';
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    ELSE
      RETURN NEW;
    END IF;
  END IF;

  -- Call Edge Function via HTTP (async, non-blocking)
  -- Use service role key to bypass RLS and allow internal calls
  -- pg_net.http_post accepts body as JSONB directly
  PERFORM net.http_post(
    url := supabase_url || '/functions/v1/sync-exercise-to-algolia',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || service_role_key,
      'X-Internal-Call', 'true'  -- Flag to indicate internal call from trigger
    ),
    body := jsonb_build_object(
      'exercise_id', exercise_id_val,
      'action', action_type,
      'internal_call', true  -- Flag in body as well for Edge Function to detect
    )
  );

  -- Return appropriate record
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    -- Log error but don't fail the transaction
    RAISE WARNING 'Failed to sync exercise to Algolia: %', SQLERRM;
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    ELSE
      RETURN NEW;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger (drop first for idempotency)
DROP TRIGGER IF EXISTS exercise_algolia_sync ON exercises;
CREATE TRIGGER exercise_algolia_sync
  AFTER INSERT OR UPDATE OR DELETE ON exercises
  FOR EACH ROW
  EXECUTE FUNCTION sync_exercise_to_algolia();

-- Add comments
COMMENT ON FUNCTION sync_exercise_to_algolia() IS 'Automatically syncs exercises to Algolia index when exercises are created, updated, or deleted. Requires app.settings.service_role_key to be configured.';

COMMENT ON TRIGGER exercise_algolia_sync ON exercises IS 'Triggers sync to Algolia when exercise data changes. Uses app.settings table for configuration (same pattern as push notifications).';


