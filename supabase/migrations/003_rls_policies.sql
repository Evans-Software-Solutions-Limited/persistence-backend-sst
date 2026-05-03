-- =====================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- =====================================================

-- Enable RLS on all tables
ALTER TABLE muscle_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE muscle_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE muscle_group_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE equipment_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE accessibility_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE goal_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_tiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_limits ENABLE ROW LEVEL SECURITY;
-- professional_subscriptions table removed - RLS no longer needed
ALTER TABLE exercises ENABLE ROW LEVEL SECURITY;
ALTER TABLE workouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE workout_exercises ENABLE ROW LEVEL SECURITY;
ALTER TABLE workout_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_exercises ENABLE ROW LEVEL SECURITY;
ALTER TABLE exercise_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE personal_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE body_measurements ENABLE ROW LEVEL SECURITY;
ALTER TABLE achievements ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_achievements ENABLE ROW LEVEL SECURITY;
ALTER TABLE friendships ENABLE ROW LEVEL SECURITY;
ALTER TABLE pt_client_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE workout_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE workout_programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE program_weeks ENABLE ROW LEVEL SECURITY;
ALTER TABLE program_workouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE health_sync_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_activity_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE sleep_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- LOOKUP TABLES (READ-ONLY FOR ALL AUTHENTICATED USERS)
-- =====================================================

CREATE POLICY "Muscle groups are viewable by everyone" 
    ON muscle_groups FOR SELECT 
    TO authenticated 
    USING (true);

CREATE POLICY "Muscle categories are viewable by everyone" 
    ON muscle_categories FOR SELECT 
    TO authenticated 
    USING (true);

CREATE POLICY "Muscle group categories are viewable by everyone" 
    ON muscle_group_categories FOR SELECT 
    TO authenticated 
    USING (true);

CREATE POLICY "Equipment types are viewable by everyone" 
    ON equipment_types FOR SELECT 
    TO authenticated 
    USING (true);

CREATE POLICY "Accessibility tags are viewable by everyone" 
    ON accessibility_tags FOR SELECT 
    TO authenticated 
    USING (true);

CREATE POLICY "Goal types viewable by everyone" 
    ON goal_types FOR SELECT 
    TO authenticated 
    USING (true);

-- =====================================================
-- PROFILES
-- =====================================================

CREATE POLICY "Users can view public profiles" 
    ON profiles FOR SELECT 
    TO authenticated 
    USING (
        is_profile_public = true 
        OR id = auth.uid()
        OR id IN (
            SELECT friend_id FROM friendships 
            WHERE user_id = auth.uid() AND status = 'accepted'
            UNION
            SELECT user_id FROM friendships 
            WHERE friend_id = auth.uid() AND status = 'accepted'
        )
        OR id IN (
            SELECT client_id FROM pt_client_relationships 
            WHERE trainer_id = auth.uid() AND status IN ('active', 'pending')
        )
        OR id IN (
            SELECT trainer_id FROM pt_client_relationships 
            WHERE client_id = auth.uid() AND status IN ('active', 'pending')
        )
    );

CREATE POLICY "Users can update own profile" 
    ON profiles FOR UPDATE 
    TO authenticated 
    USING (id = auth.uid())
    WITH CHECK (id = auth.uid());

CREATE POLICY "Users can insert own profile" 
    ON profiles FOR INSERT 
    TO authenticated 
    WITH CHECK (id = auth.uid());

-- =====================================================
-- SUBSCRIPTION SYSTEM
-- =====================================================

CREATE POLICY "Anyone can view subscription tiers" 
    ON subscription_tiers FOR SELECT 
    TO authenticated 
    USING (is_active = true);

CREATE POLICY "Users can view own subscriptions" 
    ON user_subscriptions FOR SELECT 
    TO authenticated 
    USING (user_id = auth.uid());

-- Note: Policies on views are created automatically when the view is accessed
-- The view inherits security from its underlying tables


CREATE POLICY "Users can manage own subscriptions" 
    ON user_subscriptions FOR ALL 
    TO authenticated 
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());


CREATE POLICY "Users can view own limits" 
    ON subscription_limits FOR SELECT 
    TO authenticated 
    USING (user_id = auth.uid());

CREATE POLICY "Users can manage own limits" 
    ON subscription_limits FOR ALL 
    TO authenticated 
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

-- RLS policies for professional_subscriptions removed (table deprecated)

-- =====================================================
-- EXERCISES
-- =====================================================

CREATE POLICY "Public exercises viewable by all" 
    ON exercises FOR SELECT 
    TO authenticated 
    USING (
        is_public = true 
        OR created_by = auth.uid()
        OR created_by IN (
            SELECT trainer_id FROM pt_client_relationships 
            WHERE client_id = auth.uid() AND status = 'active'
        )
    );

CREATE POLICY "Users can create own exercises" 
    ON exercises FOR INSERT 
    TO authenticated 
    WITH CHECK (created_by = auth.uid());

CREATE POLICY "Users can update own exercises" 
    ON exercises FOR UPDATE 
    TO authenticated 
    USING (created_by = auth.uid())
    WITH CHECK (created_by = auth.uid());

CREATE POLICY "Users can delete own exercises" 
    ON exercises FOR DELETE 
    TO authenticated 
    USING (created_by = auth.uid());

-- =====================================================
-- WORKOUTS
-- =====================================================

CREATE POLICY "Users can view accessible workouts" 
    ON workouts FOR SELECT 
    TO authenticated 
    USING (
        created_by = auth.uid()
        OR visibility = 'public'
        OR (
            visibility = 'friends' 
            AND created_by IN (
                SELECT friend_id FROM friendships 
                WHERE user_id = auth.uid() AND status = 'accepted'
                UNION
                SELECT user_id FROM friendships 
                WHERE friend_id = auth.uid() AND status = 'accepted'
            )
        )
        OR created_by IN (
            SELECT trainer_id FROM pt_client_relationships 
            WHERE client_id = auth.uid() AND status = 'active'
        )
        OR id IN (
            SELECT workout_id FROM workout_assignments 
            WHERE client_id = auth.uid()
        )
    );

-- Enforce subscription limits on workout creation
CREATE POLICY "Users can create workouts within subscription limits" 
    ON workouts FOR INSERT 
    TO authenticated 
    WITH CHECK (
        created_by = auth.uid() 
        AND can_user_create_workout(auth.uid())
    );

-- Enforce subscription limits on workout sharing
CREATE POLICY "Users can share workouts with Basic+ subscription" 
    ON workouts FOR UPDATE 
    TO authenticated 
    USING (
        created_by = auth.uid() 
        AND (
            visibility = 'private' 
            OR (
                visibility IN ('friends', 'public') 
                AND EXISTS (
                    SELECT 1 FROM get_user_subscription(auth.uid()) 
                    WHERE tier_name IN ('basic', 'premium')
                )
            )
        )
    );

CREATE POLICY "Users can delete own workouts" 
    ON workouts FOR DELETE 
    TO authenticated 
    USING (created_by = auth.uid());

-- =====================================================
-- WORKOUT EXERCISES
-- =====================================================

CREATE POLICY "Users can view workout exercises they have access to" 
    ON workout_exercises FOR SELECT 
    TO authenticated 
    USING (
        workout_id IN (
            SELECT id FROM workouts WHERE created_by = auth.uid()
        )
        OR workout_id IN (
            SELECT id FROM workouts WHERE visibility = 'public'
        )
        OR workout_id IN (
            SELECT id FROM workouts 
            WHERE visibility = 'friends' 
            AND created_by IN (
                SELECT friend_id FROM friendships 
                WHERE user_id = auth.uid() AND status = 'accepted'
                UNION
                SELECT user_id FROM friendships 
                WHERE friend_id = auth.uid() AND status = 'accepted'
            )
        )
        OR workout_id IN (
            SELECT workout_id FROM workout_assignments WHERE client_id = auth.uid()
        )
    );

CREATE POLICY "Users can manage exercises in own workouts" 
    ON workout_exercises FOR ALL 
    TO authenticated 
    USING (
        workout_id IN (
            SELECT id FROM workouts WHERE created_by = auth.uid()
        )
    )
    WITH CHECK (
        workout_id IN (
            SELECT id FROM workouts WHERE created_by = auth.uid()
        )
    );

-- =====================================================
-- WORKOUT SESSIONS
-- =====================================================

CREATE POLICY "View sessions with professional cross-visibility" 
    ON workout_sessions FOR SELECT 
    TO authenticated 
    USING (
        user_id = auth.uid()
        OR user_id IN (
            SELECT client_id FROM pt_client_relationships 
            WHERE trainer_id = auth.uid() AND status = 'active'
        )
    );

CREATE POLICY "Users manage own sessions" 
    ON workout_sessions FOR INSERT 
    TO authenticated 
    WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users update own sessions" 
    ON workout_sessions FOR UPDATE 
    TO authenticated 
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users delete own sessions" 
    ON workout_sessions FOR DELETE 
    TO authenticated 
    USING (user_id = auth.uid());

CREATE POLICY "Professionals can add feedback to client sessions" 
    ON workout_sessions FOR UPDATE 
    TO authenticated 
    USING (
        user_id IN (
            SELECT client_id FROM pt_client_relationships 
            WHERE trainer_id = auth.uid() AND status = 'active'
        )
    )
    WITH CHECK (
        user_id IN (
            SELECT client_id FROM pt_client_relationships 
            WHERE trainer_id = auth.uid() AND status = 'active'
        )
    );

-- =====================================================
-- SESSION EXERCISES
-- =====================================================

CREATE POLICY "Users can view session exercises they have access to" 
    ON session_exercises FOR SELECT 
    TO authenticated 
    USING (
        session_id IN (
            SELECT id FROM workout_sessions WHERE user_id = auth.uid()
        )
        OR session_id IN (
            SELECT id FROM workout_sessions 
            WHERE user_id IN (
                SELECT client_id FROM pt_client_relationships 
                WHERE trainer_id = auth.uid() AND status = 'active'
            )
        )
    );

CREATE POLICY "Users can manage own session exercises" 
    ON session_exercises FOR ALL 
    TO authenticated 
    USING (
        session_id IN (
            SELECT id FROM workout_sessions WHERE user_id = auth.uid()
        )
    )
    WITH CHECK (
        session_id IN (
            SELECT id FROM workout_sessions WHERE user_id = auth.uid()
        )
    );

-- =====================================================
-- EXERCISE SETS
-- =====================================================

CREATE POLICY "Users can view sets they have access to" 
    ON exercise_sets FOR SELECT 
    TO authenticated 
    USING (
        session_exercise_id IN (
            SELECT id FROM session_exercises 
            WHERE session_id IN (
                SELECT id FROM workout_sessions WHERE user_id = auth.uid()
            )
        )
        OR session_exercise_id IN (
            SELECT id FROM session_exercises 
            WHERE session_id IN (
                SELECT id FROM workout_sessions 
                WHERE user_id IN (
                    SELECT client_id FROM pt_client_relationships 
                    WHERE trainer_id = auth.uid() AND status = 'active'
                )
            )
        )
    );

CREATE POLICY "Users can manage own exercise sets" 
    ON exercise_sets FOR ALL 
    TO authenticated 
    USING (
        session_exercise_id IN (
            SELECT id FROM session_exercises 
            WHERE session_id IN (
                SELECT id FROM workout_sessions WHERE user_id = auth.uid()
            )
        )
    )
    WITH CHECK (
        session_exercise_id IN (
            SELECT id FROM session_exercises 
            WHERE session_id IN (
                SELECT id FROM workout_sessions WHERE user_id = auth.uid()
            )
        )
    );

-- =====================================================
-- PERSONAL RECORDS
-- =====================================================

CREATE POLICY "Users can view own PRs" 
    ON personal_records FOR SELECT 
    TO authenticated 
    USING (
        user_id = auth.uid()
        OR user_id IN (
            SELECT friend_id FROM friendships 
            WHERE user_id = auth.uid() AND status = 'accepted'
            UNION
            SELECT user_id FROM friendships 
            WHERE friend_id = auth.uid() AND status = 'accepted'
        )
        OR user_id IN (
            SELECT client_id FROM pt_client_relationships 
            WHERE trainer_id = auth.uid() AND status = 'active'
        )
    );

CREATE POLICY "Users can manage own PRs" 
    ON personal_records FOR ALL 
    TO authenticated 
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

-- =====================================================
-- BODY MEASUREMENTS
-- =====================================================

CREATE POLICY "Users can view own measurements" 
    ON body_measurements FOR SELECT 
    TO authenticated 
    USING (
        user_id = auth.uid()
        OR user_id IN (
            SELECT client_id FROM pt_client_relationships 
            WHERE trainer_id = auth.uid() AND status = 'active'
        )
    );

CREATE POLICY "Users can manage own measurements" 
    ON body_measurements FOR ALL 
    TO authenticated 
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

-- =====================================================
-- GAMIFICATION - ACHIEVEMENTS
-- =====================================================

CREATE POLICY "Achievements are viewable by everyone" 
    ON achievements FOR SELECT 
    TO authenticated 
    USING (true);

CREATE POLICY "Users can view own and friends' achievements" 
    ON user_achievements FOR SELECT 
    TO authenticated 
    USING (
        user_id = auth.uid()
        OR user_id IN (
            SELECT friend_id FROM friendships 
            WHERE user_id = auth.uid() AND status = 'accepted'
            UNION
            SELECT user_id FROM friendships 
            WHERE friend_id = auth.uid() AND status = 'accepted'
        )
    );

CREATE POLICY "Users can insert own achievements" 
    ON user_achievements FOR INSERT 
    TO authenticated 
    WITH CHECK (user_id = auth.uid());

-- =====================================================
-- FRIENDSHIPS
-- =====================================================

CREATE POLICY "Users can view own friendships" 
    ON friendships FOR SELECT 
    TO authenticated 
    USING (user_id = auth.uid() OR friend_id = auth.uid());

CREATE POLICY "Users can create friendships" 
    ON friendships FOR INSERT 
    TO authenticated 
    WITH CHECK (
        user_id = auth.uid() OR friend_id = auth.uid()
    );

CREATE POLICY "Users can update own friendships" 
    ON friendships FOR UPDATE 
    TO authenticated 
    USING (user_id = auth.uid() OR friend_id = auth.uid())
    WITH CHECK (user_id = auth.uid() OR friend_id = auth.uid());

CREATE POLICY "Users can delete own friendships" 
    ON friendships FOR DELETE 
    TO authenticated 
    USING (user_id = auth.uid() OR friend_id = auth.uid());

-- =====================================================
-- PT/PHYSIO CLIENT RELATIONSHIPS
-- =====================================================

CREATE POLICY "Users can view own PT relationships" 
    ON pt_client_relationships FOR SELECT 
    TO authenticated 
    USING (trainer_id = auth.uid() OR client_id = auth.uid());

-- Trainers can create relationships (with slot check)
CREATE POLICY "Trainers can create PT relationships" 
    ON pt_client_relationships FOR INSERT 
    TO authenticated 
    WITH CHECK (
        trainer_id = auth.uid()
        AND (
            is_ai_trainer = true
            OR (
                is_ai_trainer = false
                AND (check_trainer_slots(trainer_id)->>'has_slots')::boolean = true
            )
        )
    );

-- Both can update, but clients can only update status
CREATE POLICY "Users can update PT relationships" 
    ON pt_client_relationships FOR UPDATE 
    TO authenticated 
    USING (trainer_id = auth.uid() OR client_id = auth.uid())
    WITH CHECK (
        trainer_id = auth.uid()
        OR (
            client_id = auth.uid()
            AND status IN ('active', 'inactive')
        )
    );

-- Only trainers can delete, except clients can delete AI trainer relationships
CREATE POLICY "Only trainers can delete PT relationships" 
    ON pt_client_relationships FOR DELETE 
    TO authenticated 
    USING (
        trainer_id = auth.uid()
        OR (
            client_id = auth.uid()
            AND is_ai_trainer = true
        )
    );

-- =====================================================
-- WORKOUT ASSIGNMENTS
-- =====================================================

CREATE POLICY "View workout assignments with cross-visibility" 
    ON workout_assignments FOR SELECT 
    TO authenticated 
    USING (
        client_id = auth.uid()
        OR trainer_id = auth.uid()
        OR client_id IN (
            SELECT client_id 
            FROM pt_client_relationships
            WHERE trainer_id = auth.uid()
            AND status = 'active'
            AND is_ai_trainer = false
        )
    );

CREATE POLICY "Professionals can create assignments" 
    ON workout_assignments FOR INSERT 
    TO authenticated 
    WITH CHECK (
        trainer_id = auth.uid() 
        AND client_id IN (
            SELECT client_id FROM pt_client_relationships 
            WHERE trainer_id = auth.uid() 
            AND status = 'active'
        )
    );

CREATE POLICY "Professionals and clients can update assignments" 
    ON workout_assignments FOR UPDATE 
    TO authenticated 
    USING (
        trainer_id = auth.uid() 
        OR client_id = auth.uid()
    )
    WITH CHECK (
        trainer_id = auth.uid() 
        OR client_id = auth.uid()
    );

CREATE POLICY "Only creator can delete assignments" 
    ON workout_assignments FOR DELETE 
    TO authenticated 
    USING (trainer_id = auth.uid());

-- =====================================================
-- WORKOUT PROGRAMS
-- =====================================================

CREATE POLICY "Users can view accessible programs" 
    ON workout_programs FOR SELECT 
    TO authenticated 
    USING (
        created_by = auth.uid()
        OR is_public = true
        OR created_by IN (
            SELECT trainer_id FROM pt_client_relationships 
            WHERE client_id = auth.uid() AND status = 'active'
        )
    );

CREATE POLICY "Users can manage own programs" 
    ON workout_programs FOR ALL 
    TO authenticated 
    USING (created_by = auth.uid())
    WITH CHECK (created_by = auth.uid());

-- =====================================================
-- PROGRAM WEEKS
-- =====================================================

CREATE POLICY "Users can view program weeks they have access to" 
    ON program_weeks FOR SELECT 
    TO authenticated 
    USING (
        program_id IN (
            SELECT id FROM workout_programs 
            WHERE created_by = auth.uid() OR is_public = true
        )
    );

CREATE POLICY "Users can manage weeks in own programs" 
    ON program_weeks FOR ALL 
    TO authenticated 
    USING (
        program_id IN (
            SELECT id FROM workout_programs WHERE created_by = auth.uid()
        )
    )
    WITH CHECK (
        program_id IN (
            SELECT id FROM workout_programs WHERE created_by = auth.uid()
        )
    );

-- =====================================================
-- PROGRAM WORKOUTS
-- =====================================================

CREATE POLICY "Users can view program workouts they have access to" 
    ON program_workouts FOR SELECT 
    TO authenticated 
    USING (
        program_week_id IN (
            SELECT id FROM program_weeks 
            WHERE program_id IN (
                SELECT id FROM workout_programs 
                WHERE created_by = auth.uid() OR is_public = true
            )
        )
    );

CREATE POLICY "Users can manage workouts in own programs" 
    ON program_workouts FOR ALL 
    TO authenticated 
    USING (
        program_week_id IN (
            SELECT id FROM program_weeks 
            WHERE program_id IN (
                SELECT id FROM workout_programs WHERE created_by = auth.uid()
            )
        )
    )
    WITH CHECK (
        program_week_id IN (
            SELECT id FROM program_weeks 
            WHERE program_id IN (
                SELECT id FROM workout_programs WHERE created_by = auth.uid()
            )
        )
    );

-- =====================================================
-- GOALS
-- =====================================================

CREATE POLICY "Users can view own goals" 
    ON user_goals FOR SELECT 
    TO authenticated 
    USING (
        user_id = auth.uid()
        OR user_id IN (
            SELECT client_id FROM pt_client_relationships 
            WHERE trainer_id = auth.uid() AND status = 'active'
        )
    );

CREATE POLICY "Users can manage own goals" 
    ON user_goals FOR ALL 
    TO authenticated 
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can view own AI goals" 
    ON ai_goals FOR SELECT 
    TO authenticated 
    USING (
        user_id = auth.uid()
        OR user_id IN (
            SELECT client_id FROM pt_client_relationships 
            WHERE trainer_id = auth.uid() AND status = 'active'
        )
    );

CREATE POLICY "Users can manage own AI goals" 
    ON ai_goals FOR ALL 
    TO authenticated 
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

-- =====================================================
-- AI CONVERSATIONS
-- =====================================================

CREATE POLICY "Users can view own conversations" 
    ON ai_conversations FOR SELECT 
    TO authenticated 
    USING (user_id = auth.uid());

-- Enforce AI access on conversation creation
CREATE POLICY "Users can create AI conversations with AI access" 
    ON ai_conversations FOR INSERT 
    TO authenticated 
    WITH CHECK (
        user_id = auth.uid() 
        AND user_has_ai_access(auth.uid())
    );

-- =====================================================
-- HEALTH SYNC CONNECTIONS
-- =====================================================

CREATE POLICY "Users can manage own health connections" 
    ON health_sync_connections FOR ALL 
    TO authenticated 
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

-- =====================================================
-- DAILY ACTIVITY DATA
-- =====================================================

CREATE POLICY "Users can view own activity data" 
    ON daily_activity_data FOR SELECT 
    TO authenticated 
    USING (
        user_id = auth.uid()
        OR user_id IN (
            SELECT client_id FROM pt_client_relationships 
            WHERE trainer_id = auth.uid() AND status = 'active'
        )
    );

CREATE POLICY "Users can manage own activity data" 
    ON daily_activity_data FOR ALL 
    TO authenticated 
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

-- =====================================================
-- SLEEP DATA
-- =====================================================

CREATE POLICY "Users can view own sleep data" 
    ON sleep_data FOR SELECT 
    TO authenticated 
    USING (
        user_id = auth.uid()
        OR user_id IN (
            SELECT client_id FROM pt_client_relationships 
            WHERE trainer_id = auth.uid() AND status = 'active'
        )
    );

CREATE POLICY "Users can manage own sleep data" 
    ON sleep_data FOR ALL 
    TO authenticated 
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

-- =====================================================
-- NOTIFICATIONS
-- =====================================================

CREATE POLICY "Users can view own notifications" 
    ON notifications FOR SELECT 
    TO authenticated 
    USING (user_id = auth.uid());

CREATE POLICY "Users can update own notifications" 
    ON notifications FOR UPDATE 
    TO authenticated 
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

CREATE POLICY "System can create notifications" 
    ON notifications FOR INSERT 
    TO authenticated 
    WITH CHECK (true);

