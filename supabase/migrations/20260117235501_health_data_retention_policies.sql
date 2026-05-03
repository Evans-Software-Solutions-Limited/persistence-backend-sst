-- =====================================================
-- HEALTH DATA RETENTION POLICIES
-- =====================================================

-- Function to clean up old health data (keep last 12 months)
CREATE OR REPLACE FUNCTION cleanup_old_health_data()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER := 0;
    activity_deleted INTEGER := 0;
    sleep_deleted INTEGER := 0;
    cutoff_date DATE;
    caller_id UUID;
BEGIN
    -- Get the caller's ID
    caller_id := auth.uid();

    -- Only allow admins to run cleanup
    IF caller_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM profiles
        WHERE id = caller_id AND role = 'admin'
    ) THEN
        RAISE EXCEPTION 'Access denied: Admin privileges required for data cleanup';
    END IF;
    -- Keep 12 months of data
    cutoff_date := CURRENT_DATE - INTERVAL '12 months';

    -- Clean up daily activity data
    DELETE FROM daily_activity_data
    WHERE activity_date < cutoff_date;

    GET DIAGNOSTICS activity_deleted = ROW_COUNT;
    RAISE NOTICE 'Cleaned up % daily activity records older than %', activity_deleted, cutoff_date;

    -- Clean up sleep data
    DELETE FROM sleep_data
    WHERE sleep_date < cutoff_date;

    GET DIAGNOSTICS sleep_deleted = ROW_COUNT;
    RAISE NOTICE 'Cleaned up % sleep records older than %', sleep_deleted, cutoff_date;

    -- Total deleted count
    deleted_count := activity_deleted + sleep_deleted;

    -- Clean up old body measurements (keep all for progress tracking)
    -- Note: Body measurements are kept indefinitely for progress tracking

    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get health data summary for a user
CREATE OR REPLACE FUNCTION get_user_health_summary(p_user_id UUID, p_days INTEGER DEFAULT 30)
RETURNS JSONB AS $$
DECLARE
    result JSONB;
    caller_id UUID;
BEGIN
    -- Get the caller's ID
    caller_id := auth.uid();

    -- Only allow users to access their own health data, or admins to access any data
    IF caller_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    IF caller_id != p_user_id AND NOT EXISTS (
        SELECT 1 FROM profiles
        WHERE id = caller_id AND role = 'admin'
    ) THEN
        RAISE EXCEPTION 'Access denied: Can only access your own health data';
    END IF;
    SELECT jsonb_build_object(
        'activity_summary', jsonb_build_object(
            'avg_steps', COALESCE(ROUND(AVG(steps)), 0),
            'avg_active_minutes', COALESCE(ROUND(AVG(active_minutes)), 0),
            'avg_calories', COALESCE(ROUND(AVG(calories_burned)), 0),
            'days_with_data', COUNT(dad.activity_date),
            'date_range', jsonb_build_object(
                'start', MIN(activity_date),
                'end', MAX(activity_date)
            )
        ),
        'sleep_summary', jsonb_build_object(
            'avg_duration_hours', COALESCE(ROUND(AVG(duration_minutes) / 60.0, 1), 0),
            'avg_quality_score', COALESCE(ROUND(AVG(quality_score)), 0),
            'avg_deep_sleep_hours', COALESCE(ROUND(AVG(deep_sleep_minutes) / 60.0, 1), 0),
            'days_with_data', COUNT(sd.sleep_date),
            'date_range', jsonb_build_object(
                'start', MIN(sleep_date),
                'end', MAX(sleep_date)
            )
        ),
        'body_measurements', jsonb_build_object(
            'current_weight', (
                SELECT jsonb_build_object(
                    'value', weight_kg,
                    'measured_at', measured_at,
                    'unit', 'kg'
                )
                FROM body_measurements
                WHERE user_id = p_user_id
                AND weight_kg IS NOT NULL
                ORDER BY measured_at DESC
                LIMIT 1
            ),
            'current_body_fat', (
                SELECT jsonb_build_object(
                    'value', body_fat_percentage,
                    'measured_at', measured_at,
                    'unit', '%'
                )
                FROM body_measurements
                WHERE user_id = p_user_id
                AND body_fat_percentage IS NOT NULL
                ORDER BY measured_at DESC
                LIMIT 1
            ),
            'total_measurements', (
                SELECT COUNT(*)
                FROM body_measurements
                WHERE user_id = p_user_id
            )
        ),
        'data_completeness', jsonb_build_object(
            'has_activity_data', EXISTS(
                SELECT 1 FROM daily_activity_data
                WHERE user_id = p_user_id
                AND activity_date >= CURRENT_DATE - INTERVAL '1 day' * p_days
            ),
            'has_sleep_data', EXISTS(
                SELECT 1 FROM sleep_data
                WHERE user_id = p_user_id
                AND sleep_date >= CURRENT_DATE - INTERVAL '1 day' * p_days
            ),
            'has_body_measurements', EXISTS(
                SELECT 1 FROM body_measurements
                WHERE user_id = p_user_id
            )
        )
    ) INTO result
    FROM (
        SELECT
            dad.steps,
            dad.active_minutes,
            dad.calories_burned,
            dad.activity_date,
            sd.duration_minutes,
            sd.quality_score,
            sd.deep_sleep_minutes,
            sd.sleep_date
        FROM daily_activity_data dad
        FULL OUTER JOIN sleep_data sd ON dad.user_id = sd.user_id
            AND dad.activity_date = sd.sleep_date
        WHERE (dad.user_id = p_user_id OR sd.user_id = p_user_id)
        AND (dad.activity_date >= CURRENT_DATE - INTERVAL '1 day' * p_days
             OR sd.sleep_date >= CURRENT_DATE - INTERVAL '1 day' * p_days)
    ) health_data;

    RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- COMMENTS
-- =====================================================

COMMENT ON FUNCTION cleanup_old_health_data() IS 'Removes health data older than 12 months to manage storage. Body measurements are kept indefinitely for progress tracking.';
COMMENT ON FUNCTION get_user_health_summary(UUID, INTEGER) IS 'Returns comprehensive health data summary for a user over a specified time period.';
