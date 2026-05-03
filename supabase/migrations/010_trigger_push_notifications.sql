-- =====================================================
-- TRIGGER TO SEND PUSH NOTIFICATIONS
-- =====================================================

-- This trigger will automatically send push notifications when notifications are created
-- Note: This requires the send-push-notification Edge Function to be deployed

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
    -- Note: body must be converted to text (JSON string) for pg_net
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

-- Create trigger (non-blocking - doesn't actually send push, just logs)
DROP TRIGGER IF EXISTS notification_push_trigger ON notifications;
CREATE TRIGGER notification_push_trigger
    AFTER INSERT ON notifications
    FOR EACH ROW
    EXECUTE FUNCTION trigger_push_notification();

COMMENT ON FUNCTION trigger_push_notification IS 'Trigger that fires when notifications are created. Automatically calls send-push-notification Edge Function via pg_net to send push notifications even when app is closed. Requires app.settings.service_role_key to be configured.';


