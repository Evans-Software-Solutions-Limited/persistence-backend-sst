-- =====================================================
-- TRAINER CLIENT SUMMARY FUNCTION
-- =====================================================

CREATE OR REPLACE FUNCTION get_trainer_client_summary_data(
    p_trainer_id UUID,
    p_client_id UUID,
    p_timeframe_days INTEGER DEFAULT 30
)
RETURNS JSONB AS $$
DECLARE
    v_client_profile RECORD;
    v_workout_summary JSONB;
    v_health_summary JSONB;
    v_goals_summary JSONB;
    v_recent_notes JSONB;
    v_access_granted BOOLEAN := false;
BEGIN
    -- Verify trainer has access to this client
    SELECT EXISTS(
        SELECT 1 FROM pt_client_relationships
        WHERE trainer_id = p_trainer_id
        AND client_id = p_client_id
        AND status = 'active'
    ) INTO v_access_granted;

    IF NOT v_access_granted THEN
        RAISE EXCEPTION 'Access denied: Trainer does not have an active relationship with this client';
    END IF;

    -- Get client profile
    SELECT
        p.id,
        p.full_name,
        p.fitness_level,
        gt.name as primary_goal_name,
        p.created_at as member_since
    INTO v_client_profile
    FROM profiles p
    LEFT JOIN goal_types gt ON p.primary_goal_id = gt.id
    WHERE p.id = p_client_id;

    -- Calculate workout summary
    SELECT jsonb_build_object(
        'total_sessions', COALESCE(total_sessions, 0),
        'completed_sessions', COALESCE(completed_sessions, 0),
        'completion_rate', CASE
            WHEN total_sessions > 0 THEN ROUND((completed_sessions::DECIMAL / total_sessions) * 100, 1)
            ELSE 0
        END,
        'average_rating', COALESCE(avg_rating, 0),
        'average_rpe', COALESCE(avg_rpe, 0),
        'difficulty_ranking_avg', COALESCE(avg_difficulty, 0),
        'recent_prs', COALESCE(recent_prs, '[]'::jsonb),
        'assigned_workouts_completed', COALESCE(assigned_completed, 0),
        'assigned_workouts_pending', COALESCE(assigned_pending, 0)
    ) INTO v_workout_summary
    FROM (
        SELECT
            COUNT(*) as total_sessions,
            COUNT(*) FILTER (WHERE status = 'completed') as completed_sessions,
            ROUND(AVG(session_rating), 1) as avg_rating,
            ROUND(AVG(overall_rpe), 1) as avg_rpe,
            ROUND(AVG(difficulty_ranking), 1) as avg_difficulty
        FROM workout_sessions
        WHERE user_id = p_client_id
        AND started_at >= NOW() - INTERVAL '1 day' * p_timeframe_days
    ) w
    CROSS JOIN LATERAL (
        SELECT
            jsonb_agg(
                jsonb_build_object(
                    'exercise_name', e.name,
                    'record_type', pr.record_type,
                    'value', pr.value,
                    'achieved_at', pr.achieved_at
                )
            ) as recent_prs
        FROM (
            SELECT * FROM personal_records
            WHERE user_id = p_client_id
            AND achieved_at >= CURRENT_DATE - INTERVAL '1 day' * p_timeframe_days
            ORDER BY achieved_at DESC
            LIMIT 5
        ) pr
        JOIN exercises e ON pr.exercise_id = e.id
    ) prs
    CROSS JOIN LATERAL (
        SELECT
            COUNT(*) FILTER (WHERE status = 'completed' AND assigned_date >= CURRENT_DATE - INTERVAL '1 day' * p_timeframe_days) as assigned_completed,
            COUNT(*) FILTER (WHERE status = 'assigned' AND assigned_date >= CURRENT_DATE - INTERVAL '1 day' * p_timeframe_days) as assigned_pending
        FROM workout_assignments
        WHERE trainer_id = p_trainer_id
        AND client_id = p_client_id
        AND assigned_date >= CURRENT_DATE - INTERVAL '1 day' * p_timeframe_days
    ) wa;

    -- Calculate health summary
    SELECT jsonb_build_object(
        'weight_current', COALESCE(weight_current.value, 0),
        'weight_previous', COALESCE(weight_previous.value, 0),
        'weight_change', CASE
            WHEN weight_current.value IS NOT NULL AND weight_previous.value IS NOT NULL
            THEN ROUND(weight_current.value - weight_previous.value, 1)
            ELSE NULL
        END,
        'weight_unit', COALESCE(weight_current.unit, 'kg'),
        'weight_last_measured', weight_current.measured_at,
        'body_fat_current', COALESCE(bf_current.value, 0),
        'body_fat_previous', COALESCE(bf_previous.value, 0),
        'body_fat_change', CASE
            WHEN bf_current.value IS NOT NULL AND bf_previous.value IS NOT NULL
            THEN ROUND(bf_current.value - bf_previous.value, 1)
            ELSE NULL
        END,
        'activity_average_steps', COALESCE(avg_steps, 0),
        'activity_average_active_minutes', COALESCE(avg_active_minutes, 0),
        'resting_heart_rate_avg', COALESCE(avg_rhr, 0),
        'sleep_average_quality', COALESCE(avg_sleep_quality, 0),
        'sleep_average_duration_hours', COALESCE(avg_sleep_duration, 0),
        'has_health_data', CASE
            WHEN weight_current.value IS NOT NULL OR avg_steps > 0 OR avg_sleep_quality > 0 THEN true
            ELSE false
        END
    ) INTO v_health_summary
    FROM (
        -- Current weight (most recent)
        SELECT bm.weight_kg as value, 'kg' as unit, bm.measured_at
        FROM body_measurements bm
        WHERE bm.user_id = p_client_id
        AND bm.weight_kg IS NOT NULL
        ORDER BY bm.measured_at DESC
        LIMIT 1
    ) weight_current
    FULL OUTER JOIN (
        -- Previous weight (second most recent)
        SELECT bm.weight_kg as value, bm.measured_at
        FROM body_measurements bm
        WHERE bm.user_id = p_client_id
        AND bm.weight_kg IS NOT NULL
        ORDER BY bm.measured_at DESC
        OFFSET 1
        LIMIT 1
    ) weight_previous ON true
    FULL OUTER JOIN (
        -- Current body fat
        SELECT bm.body_fat_percentage as value, bm.measured_at
        FROM body_measurements bm
        WHERE bm.user_id = p_client_id
        AND bm.body_fat_percentage IS NOT NULL
        ORDER BY bm.measured_at DESC
        LIMIT 1
    ) bf_current ON true
    FULL OUTER JOIN (
        -- Previous body fat
        SELECT bm.body_fat_percentage as value, bm.measured_at
        FROM body_measurements bm
        WHERE bm.user_id = p_client_id
        AND bm.body_fat_percentage IS NOT NULL
        ORDER BY bm.measured_at DESC
        OFFSET 1
        LIMIT 1
    ) bf_previous ON true
    FULL OUTER JOIN (
        -- Activity averages
        SELECT
            ROUND(AVG(steps)) as avg_steps,
            ROUND(AVG(active_minutes)) as avg_active_minutes,
            ROUND(AVG(resting_heart_rate)) as avg_rhr
        FROM daily_activity_data
        WHERE user_id = p_client_id
        AND activity_date >= CURRENT_DATE - INTERVAL '1 day' * LEAST(p_timeframe_days, 90)
    ) activity ON true
    FULL OUTER JOIN (
        -- Sleep averages
        SELECT
            ROUND(AVG(quality_score)) as avg_sleep_quality,
            ROUND(AVG(duration_minutes) / 60.0, 1) as avg_sleep_duration
        FROM sleep_data
        WHERE user_id = p_client_id
        AND sleep_date >= CURRENT_DATE - INTERVAL '1 day' * LEAST(p_timeframe_days, 90)
    ) sleep ON true;

    -- Calculate goals summary
    SELECT jsonb_build_object(
        'active_goals', COALESCE(active_goals, '[]'::jsonb),
        'completed_this_period', COALESCE(completed_count, 0),
        'struggling_goals', COALESCE(struggling_goals, '[]'::jsonb)
    ) INTO v_goals_summary
    FROM (
        SELECT
            -- Active goals
            (SELECT jsonb_agg(
                jsonb_build_object(
                    'id', ug.id,
                    'goal_type', gt.name,
                    'priority', ug.priority,
                    'target_date', ug.target_date,
                    'notes', ug.notes
                )
            )
            FROM user_goals ug
            JOIN goal_types gt ON ug.goal_type_id = gt.id
            WHERE ug.user_id = p_client_id
            AND ug.is_active = true) as active_goals,

            -- Completed goals count (goals that became inactive during timeframe)
            (SELECT COUNT(*)
            FROM user_goals ug
            WHERE ug.user_id = p_client_id
            AND ug.updated_at >= NOW() - INTERVAL '1 day' * p_timeframe_days
            AND ug.is_active = false
            AND ug.updated_at > ug.created_at) as completed_count,

            -- Struggling goals (active goals created long ago without progress)
            (SELECT jsonb_agg(gt.name)
            FROM user_goals ug
            JOIN goal_types gt ON ug.goal_type_id = gt.id
            WHERE ug.user_id = p_client_id
            AND ug.created_at < NOW() - INTERVAL '1 day' * (p_timeframe_days * 2)
            AND ug.is_active = true) as struggling_goals
    ) g;

    -- Get recent trainer notes
    SELECT jsonb_agg(
        jsonb_build_object(
            'id', tcn.id,
            'title', tcn.title,
            'content', tcn.content,
            'note_type', tcn.note_type,
            'created_at', tcn.created_at
        )
    ) INTO v_recent_notes
    FROM (
        SELECT * FROM trainer_client_notes
        WHERE trainer_id = p_trainer_id
        AND client_id = p_client_id
        ORDER BY created_at DESC
        LIMIT 10
    ) tcn;

    -- Return complete summary
    RETURN jsonb_build_object(
        'client_profile', jsonb_build_object(
            'id', v_client_profile.id,
            'name', v_client_profile.full_name,
            'fitness_level', v_client_profile.fitness_level,
            'primary_goal', v_client_profile.primary_goal_name,
            'member_since', v_client_profile.member_since
        ),
        'workout_summary', v_workout_summary,
        'health_summary', v_health_summary,
        'goals_summary', v_goals_summary,
        'recent_trainer_notes', COALESCE(v_recent_notes, '[]'::jsonb),
        'timeframe_days', p_timeframe_days,
        'generated_at', NOW()
    );

EXCEPTION
    WHEN OTHERS THEN
        RAISE EXCEPTION 'Failed to generate client summary: %', SQLERRM;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- COMMENTS
-- =====================================================

COMMENT ON FUNCTION get_trainer_client_summary_data IS 'Aggregates comprehensive client data for trainer summaries including workouts, health metrics, goals, and notes';
