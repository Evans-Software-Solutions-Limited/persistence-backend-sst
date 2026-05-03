-- =====================================================
-- APP SETTINGS TABLE FOR PUSH NOTIFICATION TRIGGER
-- =====================================================

-- Create app schema and settings table for configuration
CREATE SCHEMA IF NOT EXISTS app;

CREATE TABLE IF NOT EXISTS app.settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    description TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert Supabase URL (project-specific, update if needed)
INSERT INTO app.settings (key, value, description)
VALUES ('supabase_url', 'https://dfeyebgdktfteqlacmru.supabase.co', 'Supabase project URL')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();

-- Note: service_role_key should be set manually via SQL:
-- INSERT INTO app.settings (key, value, description)
-- VALUES ('service_role_key', 'your-service-role-key-here', 'Service role key for internal Edge Function calls')
-- ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
--
-- IMPORTANT: Never commit the service_role_key to version control!
-- Get it from: Supabase Dashboard > Project Settings > API > service_role key

-- Enable RLS on app.settings for security
ALTER TABLE app.settings ENABLE ROW LEVEL SECURITY;

-- Only admins can read/write settings
CREATE POLICY "Admins can manage app settings"
    ON app.settings
    FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE id = auth.uid()
            AND role = 'admin'
        )
    );

COMMENT ON TABLE app.settings IS 'Application settings table. Stores configuration like Supabase URL and service role key for triggers. Service role key should be set by admin via SQL, never committed to version control.';

-- Update trigger function to use app.settings table
CREATE OR REPLACE FUNCTION trigger_push_notification()
RETURNS TRIGGER AS $$
DECLARE
    v_device_count INTEGER;
    v_supabase_url TEXT;
    v_service_role_key TEXT;
    v_edge_function_url TEXT;
BEGIN
    -- Check if user has active devices
    SELECT COUNT(*) INTO v_device_count
    FROM user_devices
    WHERE user_id = NEW.user_id
    AND is_active = true;
    
    -- Only send push notification if user has devices registered
    IF v_device_count = 0 THEN
        RETURN NEW;
    END IF;
    
    -- Get Supabase URL and service role key from app.settings table
    SELECT 
        (SELECT value FROM app.settings WHERE key = 'supabase_url'),
        (SELECT value FROM app.settings WHERE key = 'service_role_key')
    INTO v_supabase_url, v_service_role_key;
    
    -- If settings not configured, skip push notification
    IF v_supabase_url IS NULL OR v_supabase_url = '' THEN
        RAISE WARNING 'Supabase URL not configured in app.settings. Skipping push notification.';
        RETURN NEW;
    END IF;
    
    IF v_service_role_key IS NULL OR v_service_role_key = '' THEN
        RAISE WARNING 'Service role key not configured in app.settings. Skipping push notification.';
        RETURN NEW;
    END IF;
    
    -- Construct Edge Function URL
    v_edge_function_url := v_supabase_url || '/functions/v1/send-push-notification';
    
    -- Call Edge Function asynchronously via pg_net (non-blocking)
    -- Use service role key to bypass RLS and allow internal calls
    -- pg_net.http_post accepts body as JSONB directly
    PERFORM net.http_post(
        url := v_edge_function_url,
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || v_service_role_key,
            'X-Internal-Call', 'true'  -- Flag to indicate internal call from trigger
        ),
        body := jsonb_build_object(
            'user_id', NEW.user_id::text,
            'title', NEW.title,
            'message', NEW.message,
            'data', COALESCE(NEW.data, '{}'::jsonb),
            'notification_type', NEW.type,
            'internal_call', true  -- Flag in body as well for Edge Function to detect
        )
    );
    
    RETURN NEW;
EXCEPTION
    WHEN OTHERS THEN
        -- Log error but don't fail the notification insert
        RAISE WARNING 'Error calling push notification Edge Function: %', SQLERRM;
        RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION trigger_push_notification IS 'Trigger that fires when notifications are created. Automatically calls send-push-notification Edge Function via pg_net to send push notifications even when app is closed. Requires app.settings.service_role_key to be configured.';


