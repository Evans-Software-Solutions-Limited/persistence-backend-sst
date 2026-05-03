-- =====================================================
-- AI GYM BUDDY SCHEMA - CONVERSATIONS & PREFERENCES
-- =====================================================

-- Create enum for message modality (text vs voice)
DO $$ BEGIN
    CREATE TYPE message_modality AS ENUM ('text', 'voice');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- =====================================================
-- CONVERSATIONS TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS ai_gym_buddy_conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

    -- Conversation grouping and metadata
    session_id UUID NOT NULL,
    message_role message_role NOT NULL, -- 'user', 'assistant', 'system'
    modality message_modality DEFAULT 'text',
    content TEXT NOT NULL,

    -- Context and metadata for this message
    context JSONB DEFAULT '{}',

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),

    -- Foreign key constraint
    CONSTRAINT fk_ai_gym_buddy_user FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE
);

-- Indexes for performance
CREATE INDEX idx_ai_gym_buddy_user_session ON ai_gym_buddy_conversations(user_id, session_id);
CREATE INDEX idx_ai_gym_buddy_created ON ai_gym_buddy_conversations(created_at);
CREATE INDEX idx_ai_gym_buddy_modality ON ai_gym_buddy_conversations(modality);

-- =====================================================
-- USER PREFERENCES TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS ai_gym_buddy_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

    -- Message preferences
    enable_encouragement BOOLEAN DEFAULT true,
    enable_reminders BOOLEAN DEFAULT true,
    enable_progress_updates BOOLEAN DEFAULT true,
    enable_workout_suggestions BOOLEAN DEFAULT true,

    -- Frequency settings (in hours)
    encouragement_frequency_hours INTEGER DEFAULT 24,
    reminder_frequency_hours INTEGER DEFAULT 48,

    -- Communication preferences
    preferred_modality message_modality DEFAULT 'text',
    voice_enabled BOOLEAN DEFAULT false,

    -- Content preferences
    allow_personalized_content BOOLEAN DEFAULT true,
    allow_goal_discussions BOOLEAN DEFAULT true,

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- Constraints
    UNIQUE(user_id),
    CHECK (encouragement_frequency_hours >= 1),
    CHECK (reminder_frequency_hours >= 1)
);

-- =====================================================
-- RLS POLICIES
-- =====================================================

-- Enable RLS on conversations table
ALTER TABLE ai_gym_buddy_conversations ENABLE ROW LEVEL SECURITY;

-- Users can view their own conversations
CREATE POLICY "Users can view own conversations"
ON ai_gym_buddy_conversations FOR SELECT
TO authenticated
USING (user_id = auth.uid());

-- Users can insert their own conversations
CREATE POLICY "Users can insert own conversations"
ON ai_gym_buddy_conversations FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

-- Enable RLS on preferences table
ALTER TABLE ai_gym_buddy_preferences ENABLE ROW LEVEL SECURITY;

-- Users can view their own preferences
CREATE POLICY "Users can view own preferences"
ON ai_gym_buddy_preferences FOR SELECT
TO authenticated
USING (user_id = auth.uid());

-- Users can insert their own preferences
CREATE POLICY "Users can insert own preferences"
ON ai_gym_buddy_preferences FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

-- Users can update their own preferences
CREATE POLICY "Users can update own preferences"
ON ai_gym_buddy_preferences FOR UPDATE
TO authenticated
USING (user_id = auth.uid());

-- =====================================================
-- TRIGGER FOR UPDATED_AT
-- =====================================================

-- Add trigger for preferences updated_at
CREATE TRIGGER update_ai_gym_buddy_preferences_updated_at
    BEFORE UPDATE ON ai_gym_buddy_preferences
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- HELPER FUNCTIONS
-- =====================================================

-- Function to get detailed allowance information
CREATE OR REPLACE FUNCTION get_detailed_workout_allowance(p_user_id UUID)
RETURNS JSONB AS $$
DECLARE
    v_subscription RECORD;
    v_limit_record RECORD;
    v_can_generate BOOLEAN := false;
    v_remaining_allowance INTEGER := 0;
    v_monthly_limit INTEGER := 0;
    v_used_this_month INTEGER := 0;
    v_days_until_reset INTEGER := 30;
BEGIN
    -- Get user's subscription
    SELECT * INTO v_subscription FROM get_user_subscription(p_user_id) LIMIT 1;

    -- Check if user has AI access
    IF v_subscription.tier_name IS NOT NULL AND v_subscription.ai_access THEN
        -- Get current month's usage
        SELECT * INTO v_limit_record
        FROM subscription_limits
        WHERE user_id = p_user_id
        AND limit_type = 'ai_workouts'
        AND reset_date >= date_trunc('month', NOW());

        -- Determine limits based on subscription (use database configuration)
        IF v_subscription.ai_workout_limit IS NULL THEN
            -- NULL = unlimited (for enterprise/partner tiers)
            v_monthly_limit := 9999; -- Effectively unlimited
            v_used_this_month := COALESCE(v_limit_record.current_count, 0);
            v_remaining_allowance := GREATEST(0, v_monthly_limit - v_used_this_month);
            v_can_generate := true;
        ELSIF v_subscription.ai_workout_limit = 0 THEN
            -- 0 = no access
            v_monthly_limit := 0;
            v_can_generate := false;
        ELSE
            -- Use configured limit from database
            v_monthly_limit := v_subscription.ai_workout_limit;
            v_used_this_month := COALESCE(v_limit_record.current_count, 0);
            v_remaining_allowance := GREATEST(0, v_monthly_limit - v_used_this_month);
            v_can_generate := v_remaining_allowance > 0;
        END IF;

        -- Calculate days until reset (start of next month)
        v_days_until_reset := GREATEST(0, EXTRACT(EPOCH FROM (date_trunc('month', NOW() + INTERVAL '1 month') - NOW())) / 86400)::INTEGER;
    END IF;

    -- Return detailed allowance information
    RETURN jsonb_build_object(
        'can_generate', v_can_generate,
        'remaining_allowance', v_remaining_allowance,
        'monthly_limit', v_monthly_limit,
        'used_this_month', v_used_this_month,
        'days_until_reset', v_days_until_reset,
        'subscription_tier', COALESCE(v_subscription.tier_name, 'free')
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get user context for AI gym buddy
CREATE OR REPLACE FUNCTION get_ai_gym_buddy_user_context(p_user_id UUID)
RETURNS JSONB AS $$
DECLARE
    v_profile RECORD;
    v_allowance JSONB;
    v_recent_workouts INTEGER := 0;
    v_has_trainer BOOLEAN := false;
    v_assigned_workouts JSONB := '[]'::jsonb;
    v_recent_prs JSONB := '[]'::jsonb;
    v_preferences RECORD;
BEGIN
    -- Get user profile with goal name
    SELECT
        p.*,
        gt.name as primary_goal_name
    INTO v_profile
    FROM profiles p
    LEFT JOIN goal_types gt ON p.primary_goal_id = gt.id
    WHERE p.id = p_user_id;

    -- Get workout allowance
    SELECT get_detailed_workout_allowance(p_user_id) INTO v_allowance;

    -- Count recent workouts (last 30 days)
    SELECT COUNT(*) INTO v_recent_workouts
    FROM workout_sessions
    WHERE user_id = p_user_id
    AND status = 'completed'
    AND completed_at >= NOW() - INTERVAL '30 days';

    -- Check if user has active trainer relationship
    SELECT EXISTS(
        SELECT 1 FROM pt_client_relationships
        WHERE client_id = p_user_id
        AND status = 'active'
    ) INTO v_has_trainer;

    -- Get assigned workouts if user has trainer
    IF v_has_trainer THEN
        SELECT jsonb_agg(workout_data) INTO v_assigned_workouts
        FROM (
            SELECT
                jsonb_build_object(
                    'id', wa.id,
                    'name', w.name,
                    'assigned_date', wa.assigned_date,
                    'due_date', wa.due_date,
                    'status', wa.status
                ) as workout_data
            FROM workout_assignments wa
            JOIN workouts w ON wa.workout_id = w.id
            WHERE wa.client_id = p_user_id
            AND wa.status = 'assigned'
            ORDER BY wa.assigned_date DESC
            LIMIT 5
        ) limited_workouts;
    END IF;

    -- Get recent PRs
    SELECT jsonb_agg(pr_data) INTO v_recent_prs
    FROM (
        SELECT
            jsonb_build_object(
                'exercise_name', e.name,
                'record_type', pr.record_type,
                'value', pr.value,
                'achieved_at', pr.achieved_at
            ) as pr_data
        FROM personal_records pr
        JOIN exercises e ON pr.exercise_id = e.id
        WHERE pr.user_id = p_user_id
        ORDER BY pr.achieved_at DESC
        LIMIT 5
    ) limited_prs;

    -- Get user preferences
    SELECT * INTO v_preferences FROM ai_gym_buddy_preferences WHERE user_id = p_user_id;

    -- Return complete context
    RETURN jsonb_build_object(
        'user_id', p_user_id,
        'name', COALESCE(v_profile.full_name, 'there'),
        'fitness_level', COALESCE(v_profile.fitness_level, 'beginner'),
        'primary_goal', COALESCE(v_profile.primary_goal_name, 'General fitness'),
        'available_equipment', COALESCE(v_profile.available_equipment, ARRAY[]::TEXT[]),
        'recent_workout_count', v_recent_workouts,
        'level', COALESCE(v_profile.level, 1),
        'has_trainer', v_has_trainer,
        'assigned_workouts', COALESCE(v_assigned_workouts, '[]'::jsonb),
        'recent_prs', COALESCE(v_recent_prs, '[]'::jsonb),
        'workout_allowance', v_allowance,
        'preferences', CASE
            WHEN v_preferences IS NOT NULL THEN
                jsonb_build_object(
                    'enable_encouragement', v_preferences.enable_encouragement,
                    'enable_reminders', v_preferences.enable_reminders,
                    'preferred_modality', v_preferences.preferred_modality,
                    'voice_enabled', v_preferences.voice_enabled
                )
            ELSE
                jsonb_build_object(
                    'enable_encouragement', true,
                    'enable_reminders', true,
                    'preferred_modality', 'text',
                    'voice_enabled', false
                )
        END
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- COMMENTS
-- =====================================================

COMMENT ON TABLE ai_gym_buddy_conversations IS 'Stores AI Gym Buddy chat conversations and history with multimodal support';
COMMENT ON TABLE ai_gym_buddy_preferences IS 'Stores user preferences for AI Gym Buddy interactions and messaging';
COMMENT ON FUNCTION get_detailed_workout_allowance IS 'Returns detailed workout generation allowance information for users';
COMMENT ON FUNCTION get_ai_gym_buddy_user_context IS 'Returns complete user context for AI gym buddy conversations including goals, workouts, and preferences';
