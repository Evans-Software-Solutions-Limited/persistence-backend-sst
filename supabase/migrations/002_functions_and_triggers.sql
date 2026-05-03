-- =====================================================
-- FUNCTIONS AND TRIGGERS
-- =====================================================

-- =====================================================
-- UPDATED_AT TRIGGER FUNCTION
-- =====================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at triggers
DROP TRIGGER IF EXISTS update_profiles_updated_at ON profiles;
CREATE TRIGGER update_profiles_updated_at 
    BEFORE UPDATE ON profiles 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_exercises_updated_at ON exercises;
CREATE TRIGGER update_exercises_updated_at 
    BEFORE UPDATE ON exercises 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_workouts_updated_at ON workouts;
CREATE TRIGGER update_workouts_updated_at 
    BEFORE UPDATE ON workouts 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_friendships_updated_at ON friendships;
CREATE TRIGGER update_friendships_updated_at 
    BEFORE UPDATE ON friendships 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_pt_relationships_updated_at ON pt_client_relationships;
CREATE TRIGGER update_pt_relationships_updated_at 
    BEFORE UPDATE ON pt_client_relationships 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_workout_programs_updated_at ON workout_programs;
CREATE TRIGGER update_workout_programs_updated_at 
    BEFORE UPDATE ON workout_programs 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_ai_goals_updated_at ON ai_goals;
CREATE TRIGGER update_ai_goals_updated_at 
    BEFORE UPDATE ON ai_goals 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_health_sync_updated_at ON health_sync_connections;
CREATE TRIGGER update_health_sync_updated_at 
    BEFORE UPDATE ON health_sync_connections 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_user_goals_updated_at ON user_goals;
CREATE TRIGGER update_user_goals_updated_at 
    BEFORE UPDATE ON user_goals 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_user_subscriptions_updated_at ON user_subscriptions;
CREATE TRIGGER update_user_subscriptions_updated_at 
    BEFORE UPDATE ON user_subscriptions 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();


DROP TRIGGER IF EXISTS update_subscription_limits_updated_at ON subscription_limits;
CREATE TRIGGER update_subscription_limits_updated_at 
    BEFORE UPDATE ON subscription_limits 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Trigger for professional_subscriptions removed (table deprecated)

-- =====================================================
-- RANDOM USERNAME GENERATOR
-- =====================================================

CREATE OR REPLACE FUNCTION public.generate_random_username()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  adjectives TEXT[] := ARRAY[
    'happy', 'bright', 'swift', 'brave', 'calm', 'cool', 'daring', 'eager', 
    'fierce', 'gentle', 'jolly', 'keen', 'lively', 'mighty', 'noble', 'proud',
    'quick', 'radiant', 'sharp', 'tough', 'vivid', 'witty', 'zen', 'bold',
    'clever', 'dynamic', 'epic', 'fresh', 'golden', 'heroic', 'infinite', 'jade',
    'lucky', 'magic', 'neon', 'ocean', 'prime', 'quantum', 'rapid', 'stellar',
    'titan', 'ultra', 'vortex', 'wild', 'xeno', 'youth', 'zenith', 'alpha',
    'beta', 'cosmic', 'delta', 'echo', 'flame', 'glow', 'hyper', 'iron',
    'jade', 'knight', 'lunar', 'nova', 'omega', 'phoenix', 'quantum', 'royal',
    'solar', 'thunder', 'ultra', 'vapor', 'winter', 'xray', 'yeti', 'zephyr'
  ];
  nouns TEXT[] := ARRAY[
    'tiger', 'eagle', 'wolf', 'lion', 'bear', 'hawk', 'fox', 'panther',
    'falcon', 'shark', 'dragon', 'phoenix', 'raven', 'jaguar', 'lynx', 'orca',
    'stallion', 'cobra', 'viper', 'thunder', 'storm', 'blaze', 'frost', 'shadow',
    'star', 'moon', 'sun', 'comet', 'nebula', 'galaxy', 'planet', 'asteroid',
    'wave', 'ocean', 'river', 'mountain', 'valley', 'forest', 'canyon', 'cliff',
    'blade', 'shield', 'arrow', 'spear', 'sword', 'hammer', 'axe', 'bow',
    'flame', 'ember', 'spark', 'lightning', 'thunder', 'wind', 'breeze', 'gale',
    'crystal', 'gem', 'diamond', 'pearl', 'ruby', 'sapphire', 'emerald', 'opal',
    'warrior', 'knight', 'ranger', 'scout', 'guardian', 'champion', 'hero', 'legend',
    'voyager', 'explorer', 'pioneer', 'trailblazer', 'wanderer', 'nomad', 'seeker', 'finder'
  ];
  v_adjective TEXT;
  v_noun TEXT;
  v_username TEXT;
BEGIN
  -- Randomly select one adjective and one noun
  v_adjective := adjectives[1 + floor(random() * array_length(adjectives, 1))::int];
  v_noun := nouns[1 + floor(random() * array_length(nouns, 1))::int];
  
  -- Combine with underscore
  v_username := v_adjective || '_' || v_noun;
  
  -- Add a random 2-digit number for extra uniqueness (00-99)
  v_username := v_username || floor(random() * 100)::int;
  
  RETURN v_username;
END;
$$;

-- =====================================================
-- PROFILE CREATION TRIGGER
-- =====================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER 
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_username TEXT;
  v_base_username TEXT;
  v_suffix TEXT;
  v_attempts INTEGER := 0;
  v_max_attempts INTEGER := 100;
BEGIN
  -- Generate base username from metadata, or use random word generator if not provided
  IF NEW.raw_user_meta_data->>'username' IS NOT NULL AND NEW.raw_user_meta_data->>'username' != '' THEN
    -- Use provided username
    v_base_username := NEW.raw_user_meta_data->>'username';
    -- Normalize: lowercase first, then remove non-alphanumeric characters (except underscores)
    v_base_username := regexp_replace(lower(v_base_username), '[^a-z0-9_]', '', 'g');
  ELSIF NEW.raw_user_meta_data->>'full_name' IS NOT NULL AND NEW.raw_user_meta_data->>'full_name' != '' THEN
    -- Use full name if available
    v_base_username := NEW.raw_user_meta_data->>'full_name';
    -- Normalize: lowercase first, then remove non-alphanumeric characters (except underscores)
    v_base_username := regexp_replace(lower(v_base_username), '[^a-z0-9_]', '', 'g');
  ELSE
    -- No username or full_name provided, generate random word-based username
    v_base_username := public.generate_random_username();
  END IF;
  
  -- Ensure username is not empty (fallback to random generator)
  IF v_base_username = '' OR v_base_username IS NULL THEN
    v_base_username := public.generate_random_username();
  END IF;

  -- Start with base username
  v_username := v_base_username;
  
  -- Check if username exists and generate unique one if needed
  WHILE EXISTS (SELECT 1 FROM public.profiles WHERE username = v_username) AND v_attempts < v_max_attempts LOOP
    v_attempts := v_attempts + 1;
    -- Generate random suffix (4 characters)
    v_suffix := lower(substring(md5(random()::text || v_attempts::text) from 1 for 4));
    v_username := v_base_username || '_' || v_suffix;
  END LOOP;

  -- Insert profile with unique username (no subscription fields - single source of truth)
  INSERT INTO public.profiles (
    id,
    email,
    username,
    full_name,
    role,
    fitness_level
  )
  VALUES (
    NEW.id,
    NEW.email,
    v_username,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    'user'::user_role,
    'beginner'::fitness_level
  );

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'Error creating profile for user %: % (SQLSTATE: %)', NEW.id, SQLERRM, SQLSTATE;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW 
  EXECUTE FUNCTION public.handle_new_user();

-- =====================================================
-- ROLE FLAGS SYNC TRIGGER
-- =====================================================

-- Role synchronization removed - role enum is now the single source of truth

-- =====================================================
-- PERSONAL RECORD DETECTION
-- =====================================================

CREATE OR REPLACE FUNCTION check_and_update_pr(
    p_user_id UUID,
    p_exercise_id UUID,
    p_set_id UUID,
    p_weight_kg DECIMAL,
    p_reps INTEGER
)
RETURNS JSONB AS $$
DECLARE
    v_current_max_weight DECIMAL;
    v_new_pr BOOLEAN := false;
    v_pr_type record_type;
    v_records_broken JSONB := '[]'::JSONB;
    v_notification_id UUID;
BEGIN
    -- Check for max weight PR
    SELECT value INTO v_current_max_weight
    FROM personal_records
    WHERE user_id = p_user_id 
    AND exercise_id = p_exercise_id 
    AND record_type = 'max_weight';
    
    IF v_current_max_weight IS NULL OR p_weight_kg > v_current_max_weight THEN
        INSERT INTO personal_records (user_id, exercise_id, record_type, value, set_id)
        VALUES (p_user_id, p_exercise_id, 'max_weight', p_weight_kg, p_set_id)
        ON CONFLICT (user_id, exercise_id, record_type) 
        DO UPDATE SET 
            value = p_weight_kg,
            set_id = p_set_id,
            achieved_at = NOW();
        
        v_records_broken := v_records_broken || jsonb_build_object(
            'type', 'max_weight',
            'value', p_weight_kg,
            'old_value', v_current_max_weight
        );
        v_new_pr := true;
    END IF;
    
    -- Check for rep-specific PRs
    IF p_reps = 1 THEN
        v_pr_type := '1rm';
    ELSIF p_reps = 3 THEN
        v_pr_type := '3rm';
    ELSIF p_reps = 5 THEN
        v_pr_type := '5rm';
    ELSIF p_reps = 10 THEN
        v_pr_type := '10rm';
    ELSE
        v_pr_type := NULL;
    END IF;
    
    IF v_pr_type IS NOT NULL THEN
        DECLARE
            v_current_rep_max DECIMAL;
        BEGIN
            SELECT value INTO v_current_rep_max
            FROM personal_records
            WHERE user_id = p_user_id 
            AND exercise_id = p_exercise_id 
            AND record_type = v_pr_type;
            
            IF v_current_rep_max IS NULL OR p_weight_kg > v_current_rep_max THEN
                INSERT INTO personal_records (user_id, exercise_id, record_type, value, set_id)
                VALUES (p_user_id, p_exercise_id, v_pr_type, p_weight_kg, p_set_id)
                ON CONFLICT (user_id, exercise_id, record_type) 
                DO UPDATE SET 
                    value = p_weight_kg,
                    set_id = p_set_id,
                    achieved_at = NOW();
                
                v_records_broken := v_records_broken || jsonb_build_object(
                    'type', v_pr_type,
                    'value', p_weight_kg,
                    'old_value', v_current_rep_max
                );
                v_new_pr := true;
            END IF;
        END;
    END IF;
    
    -- If a PR was broken, mark the set (notifications removed)
    IF v_new_pr THEN
        UPDATE exercise_sets 
        SET is_personal_record = true 
        WHERE id = p_set_id;
        
        -- Removed notification creation for new_personal_record
    END IF;
    
    RETURN jsonb_build_object(
        'new_pr', v_new_pr,
        'records_broken', v_records_broken
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION trigger_check_pr()
RETURNS TRIGGER AS $$
DECLARE
    v_user_id UUID;
    v_exercise_id UUID;
BEGIN
    SELECT ws.user_id, se.exercise_id
    INTO v_user_id, v_exercise_id
    FROM session_exercises se
    JOIN workout_sessions ws ON ws.id = se.session_id
    WHERE se.id = NEW.session_exercise_id;
    
    IF NEW.weight_kg IS NOT NULL AND NEW.reps IS NOT NULL THEN
        PERFORM check_and_update_pr(
            v_user_id, v_exercise_id, NEW.id, NEW.weight_kg, NEW.reps
        );
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS auto_check_pr_after_set_insert ON exercise_sets;
CREATE TRIGGER auto_check_pr_after_set_insert
    AFTER INSERT ON exercise_sets
    FOR EACH ROW
    EXECUTE FUNCTION trigger_check_pr();

-- =====================================================
-- USER STATS FUNCTION
-- =====================================================

CREATE OR REPLACE FUNCTION get_user_stats(p_user_id UUID)
RETURNS JSONB AS $$
DECLARE
    v_stats JSONB;
    v_total_workouts INTEGER;
    v_total_sets INTEGER;
    v_total_reps INTEGER;
    v_total_weight_lifted DECIMAL;
    v_current_streak INTEGER;
    v_longest_streak INTEGER;
    v_pr_count INTEGER;
    v_caller_id UUID;
    v_has_access BOOLEAN;
BEGIN
    v_caller_id := auth.uid();
    
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;
    
    IF v_caller_id = p_user_id THEN
        v_has_access := TRUE;
    ELSE
        SELECT EXISTS(
            SELECT 1 
            FROM pt_client_relationships 
            WHERE trainer_id = v_caller_id 
            AND client_id = p_user_id 
            AND status = 'active'
        ) INTO v_has_access;
    END IF;
    
    IF NOT v_has_access THEN
        RAISE EXCEPTION 'Access denied: You can only view your own stats or stats of your clients';
    END IF;
    
    SELECT COALESCE(COUNT(*), 0) INTO v_total_workouts
    FROM workout_sessions
    WHERE user_id = p_user_id AND status = 'completed';

    SELECT 
        COALESCE(COUNT(es.id), 0),
        COALESCE(SUM(es.reps), 0),
        COALESCE(SUM(es.weight_kg * es.reps), 0)
    INTO v_total_sets, v_total_reps, v_total_weight_lifted
    FROM workout_sessions ws
    JOIN session_exercises se ON se.session_id = ws.id
    JOIN exercise_sets es ON es.session_exercise_id = se.id
    WHERE ws.user_id = p_user_id AND ws.status = 'completed';

    SELECT COALESCE(COUNT(*), 0) INTO v_pr_count
    FROM personal_records
    WHERE user_id = p_user_id;

    v_current_streak := 0;
    v_longest_streak := 0;

    v_stats := jsonb_build_object(
        'total_workouts', v_total_workouts,
        'total_sets', v_total_sets,
        'total_reps', v_total_reps,
        'total_weight_lifted_kg', v_total_weight_lifted,
        'current_streak', v_current_streak,
        'longest_streak', v_longest_streak,
        'personal_records', v_pr_count
    );
    
    RETURN v_stats;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- ALTERNATIVE EXERCISES FUNCTION
-- =====================================================

CREATE OR REPLACE FUNCTION get_alternative_exercises(
    p_exercise_id UUID,
    p_user_id UUID DEFAULT NULL
)
RETURNS TABLE (
    id UUID,
    name TEXT,
    difficulty_level exercise_difficulty,
    match_score INTEGER
) AS $$
DECLARE
    v_primary_muscles UUID[];
    v_secondary_muscles UUID[];
    v_equipment_required UUID[];
    v_difficulty exercise_difficulty;
    v_user_equipment UUID[];
    v_user_accessibility UUID[];
BEGIN
    SELECT 
        e.primary_muscles, e.secondary_muscles, e.equipment_required, e.difficulty_level
    INTO 
        v_primary_muscles, v_secondary_muscles, v_equipment_required, v_difficulty
    FROM exercises e
    WHERE e.id = p_exercise_id;
    
    IF p_user_id IS NOT NULL THEN
        SELECT available_equipment, accessibility_needs
        INTO v_user_equipment, v_user_accessibility
        FROM profiles
        WHERE profiles.id = p_user_id;
    END IF;
    
    RETURN QUERY
    SELECT 
        e.id, e.name, e.difficulty_level,
        (
            (CASE WHEN e.primary_muscles && v_primary_muscles THEN 50 ELSE 0 END) +
            (CASE WHEN e.secondary_muscles && v_secondary_muscles THEN 20 ELSE 0 END) +
            (CASE WHEN e.difficulty_level = v_difficulty THEN 15 ELSE 0 END) +
            (CASE 
                WHEN p_user_id IS NULL THEN 0
                WHEN v_user_equipment @> e.equipment_required THEN 15 
                ELSE -30
            END)
        ) AS match_score
    FROM exercises e
    WHERE 
        e.id != p_exercise_id
        AND e.is_public = true
        AND e.primary_muscles && v_primary_muscles
        AND (
            p_user_id IS NULL 
            OR NOT (e.accessibility_requirements && v_user_accessibility)
        )
    ORDER BY match_score DESC, e.name
    LIMIT 10;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- NOTIFICATION TRIGGERS
-- =====================================================

CREATE OR REPLACE FUNCTION create_friendship_notifications()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' AND NEW.status = 'pending' THEN
        INSERT INTO notifications (
            user_id, type, title, message, related_entity_type, related_entity_id, data
        )
        SELECT
            NEW.friend_id, 
            'friend_request', 
            'New Friend Request',
            (SELECT full_name FROM profiles WHERE id = NEW.user_id) || ' sent you a friend request',
            'friendship', 
            NEW.id,
            jsonb_build_object(
                'deeplink', 'persistencemobile://profile',
                'friend_id', NEW.user_id::text
            );
    END IF;
    
    -- Removed friend_accepted notification creation
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS friendship_notifications ON friendships;
CREATE TRIGGER friendship_notifications
    AFTER INSERT OR UPDATE ON friendships
    FOR EACH ROW
    EXECUTE FUNCTION create_friendship_notifications();

CREATE OR REPLACE FUNCTION create_pt_relationship_notifications()
RETURNS TRIGGER AS $$
DECLARE
    v_trainer_role user_role;
    v_relationship_type TEXT;
BEGIN
    -- Handle DELETE operation (no notification created, just return OLD)
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    
    -- For INSERT and UPDATE, NEW is available
    SELECT role INTO v_trainer_role
    FROM profiles
    WHERE id = NEW.trainer_id;
    
    v_relationship_type := CASE 
        WHEN NEW.is_ai_trainer THEN 'AI Trainer'
        WHEN v_trainer_role = 'physiotherapist' THEN 'Physiotherapist'
        WHEN v_trainer_role = 'personal_trainer' THEN 'Personal Trainer'
        ELSE 'Trainer'
    END;
    
    IF TG_OP = 'INSERT' AND NEW.status = 'pending' THEN
        INSERT INTO notifications (
            user_id, type, title, message, related_entity_type, related_entity_id, data
        )
        SELECT
            NEW.client_id,
            (CASE 
                WHEN NEW.is_ai_trainer THEN 'pt_request'
                WHEN v_trainer_role = 'physiotherapist' THEN 'physio_request'
                ELSE 'pt_request'
            END)::notification_type,
            CASE 
                WHEN NEW.is_ai_trainer THEN 'AI Personal Trainer'
                WHEN v_trainer_role = 'physiotherapist' THEN 'Physiotherapist Request'
                ELSE 'Training Request'
            END,
            CASE 
                WHEN NEW.is_ai_trainer THEN 'Your AI Personal Trainer is ready to help you reach your goals'
                ELSE (SELECT full_name FROM profiles WHERE id = NEW.trainer_id) || 
                     ' wants to be your ' || LOWER(v_relationship_type)
            END,
            'pt_relationship', 
            NEW.id,
            jsonb_build_object(
                'is_ai_trainer', NEW.is_ai_trainer,
                'trainer_role', v_trainer_role,
                'relationship_reason', NEW.relationship_reason,
                'deeplink', 'persistencemobile://profile',
                'trainer_id', NEW.trainer_id::text,
                'relationship_id', NEW.id::text
            );
    END IF;
    
    IF TG_OP = 'UPDATE' AND OLD.status = 'pending' AND NEW.status = 'active' AND NEW.is_ai_trainer = false THEN
        INSERT INTO notifications (
            user_id, type, title, message, related_entity_type, related_entity_id, data
        )
        SELECT
            NEW.trainer_id,
            (CASE 
                WHEN v_trainer_role = 'physiotherapist' THEN 'physio_accepted'
                ELSE 'pt_accepted'
            END)::notification_type,
            'Client Accepted',
            (SELECT full_name FROM profiles WHERE id = NEW.client_id) || ' accepted your request',
            'pt_relationship', 
            NEW.id,
            jsonb_build_object(
                'deeplink', 'persistencemobile://clients?clientId=' || NEW.client_id::text,
                'client_id', NEW.client_id::text,
                'relationship_id', NEW.id::text
            );
    END IF;
    
    -- Return NEW for INSERT and UPDATE operations
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS pt_relationship_notifications ON pt_client_relationships;
CREATE TRIGGER pt_relationship_notifications
    AFTER INSERT OR UPDATE OR DELETE ON pt_client_relationships
    FOR EACH ROW
    EXECUTE FUNCTION create_pt_relationship_notifications();

CREATE OR REPLACE FUNCTION create_assignment_notification()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO notifications (
            user_id, type, title, message, related_entity_type, related_entity_id, data
        )
        SELECT
            NEW.client_id, 
            'workout_assigned', 
            'New Workout Assigned',
            (SELECT full_name FROM profiles WHERE id = NEW.trainer_id) || ' assigned you a workout',
            'workout_assignment', 
            NEW.id,
            jsonb_build_object(
                'workout_id', NEW.workout_id::text,
                'due_date', NEW.due_date,
                'deeplink', 'persistencemobile://workouts?workoutId=' || NEW.workout_id::text,
                'assignment_id', NEW.id::text
            );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS assignment_notifications ON workout_assignments;
CREATE TRIGGER assignment_notifications
    AFTER INSERT ON workout_assignments
    FOR EACH ROW
    EXECUTE FUNCTION create_assignment_notification();

-- =====================================================
-- WORKOUT METADATA FUNCTIONS
-- =====================================================

CREATE OR REPLACE FUNCTION get_workout_metadata(p_workout_ids UUID[])
RETURNS TABLE (
    workout_id UUID,
    regions JSONB,
    movements JSONB,
    targeted_muscles JSONB,
    equipment_required JSONB
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        w.id as workout_id,
        COALESCE(
            (SELECT JSONB_AGG(DISTINCT e2.region_type)
             FROM workout_exercises we2
             JOIN exercises e2 ON we2.exercise_id = e2.id
             WHERE we2.workout_id = w.id AND e2.region_type IS NOT NULL),
            '[]'::JSONB
        ) as regions,
        COALESCE(
            (SELECT JSONB_AGG(DISTINCT e2.movement_type)
             FROM workout_exercises we2
             JOIN exercises e2 ON we2.exercise_id = e2.id
             WHERE we2.workout_id = w.id AND e2.movement_type IS NOT NULL),
            '[]'::JSONB
        ) as movements,
        COALESCE(
            (SELECT JSONB_AGG(
                JSONB_BUILD_OBJECT('id', mg.id, 'name', mg.name, 'display_name', COALESCE(mg.display_name, mg.name))
             )
             FROM (SELECT DISTINCT mg.id, mg.name, mg.display_name
                   FROM workout_exercises we2
                   JOIN exercises e2 ON we2.exercise_id = e2.id
                   JOIN muscle_groups mg ON mg.id = ANY(e2.primary_muscles)
                   WHERE we2.workout_id = w.id AND e2.primary_muscles IS NOT NULL) mg),
            '[]'::JSONB
        ) as targeted_muscles,
        COALESCE(
            (SELECT JSONB_AGG(JSONB_BUILD_OBJECT('id', et.id, 'name', et.name))
             FROM (SELECT DISTINCT unnest(e2.equipment_required) as equipment_id
                   FROM workout_exercises we2
                   JOIN exercises e2 ON we2.exercise_id = e2.id
                   WHERE we2.workout_id = w.id AND e2.equipment_required IS NOT NULL) equipment_ids
             JOIN equipment_types et ON equipment_ids.equipment_id = et.id),
            '[]'::JSONB
        ) as equipment_required
    FROM workouts w
    WHERE w.id = ANY(p_workout_ids);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION get_workout_metadata_single(p_workout_id UUID)
RETURNS JSONB AS $$
DECLARE
    result JSONB;
BEGIN
    SELECT JSONB_BUILD_OBJECT(
        'regions', COALESCE(
            (SELECT JSONB_AGG(DISTINCT e2.region_type)
             FROM workout_exercises we2
             JOIN exercises e2 ON we2.exercise_id = e2.id
             WHERE we2.workout_id = p_workout_id AND e2.region_type IS NOT NULL),
            '[]'::JSONB
        ),
        'movements', COALESCE(
            (SELECT JSONB_AGG(DISTINCT e2.movement_type)
             FROM workout_exercises we2
             JOIN exercises e2 ON we2.exercise_id = e2.id
             WHERE we2.workout_id = p_workout_id AND e2.movement_type IS NOT NULL),
            '[]'::JSONB
        ),
        'targeted_muscles', COALESCE(
            (SELECT JSONB_AGG(JSONB_BUILD_OBJECT('id', mg.id, 'name', mg.name, 'display_name', COALESCE(mg.display_name, mg.name)))
             FROM (SELECT DISTINCT mg.id, mg.name, mg.display_name
                   FROM workout_exercises we2
                   JOIN exercises e2 ON we2.exercise_id = e2.id
                   JOIN muscle_groups mg ON mg.id = ANY(e2.primary_muscles)
                   WHERE we2.workout_id = p_workout_id AND e2.primary_muscles IS NOT NULL) mg),
            '[]'::JSONB
        ),
        'equipment_required', COALESCE(
            (SELECT JSONB_AGG(JSONB_BUILD_OBJECT('id', et.id, 'name', et.name))
             FROM (SELECT DISTINCT unnest(e2.equipment_required) as equipment_id
                   FROM workout_exercises we2
                   JOIN exercises e2 ON we2.exercise_id = e2.id
                   WHERE we2.workout_id = p_workout_id AND e2.equipment_required IS NOT NULL) equipment_ids
             JOIN equipment_types et ON equipment_ids.equipment_id = et.id),
            '[]'::JSONB
        )
    ) INTO result;
    
    RETURN result;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- VIEWS
-- =====================================================

CREATE OR REPLACE VIEW user_profile_with_goals AS
SELECT 
    p.id, p.email, p.full_name, p.username, p.role, p.fitness_level,
    p.primary_goal_id, pg.name as primary_goal_name, pg.description as primary_goal_description,
    (SELECT json_agg(
        json_build_object(
            'goal_type_id', ug.goal_type_id, 'goal_name', gt.name,
            'goal_category', gt.category, 'priority', ug.priority,
            'target_date', ug.target_date, 'notes', ug.notes
        ) ORDER BY ug.priority
    )
    FROM user_goals ug
    JOIN goal_types gt ON gt.id = ug.goal_type_id
    WHERE ug.user_id = p.id AND ug.is_active = true) as active_goals
FROM profiles p
LEFT JOIN goal_types pg ON pg.id = p.primary_goal_id;

GRANT SELECT ON user_profile_with_goals TO authenticated;

CREATE OR REPLACE VIEW client_professional_team AS
SELECT
    ptr.client_id, c.full_name as client_name,
    ptr.trainer_id as professional_id, p.full_name as professional_name,
    p.role as primary_role,
    (p.role = 'personal_trainer') as is_personal_trainer,
    (p.role = 'physiotherapist') as is_physiotherapist,
    ptr.relationship_reason, ptr.status, ptr.created_at as relationship_started
FROM pt_client_relationships ptr
JOIN profiles p ON p.id = ptr.trainer_id
JOIN profiles c ON c.id = ptr.client_id
WHERE ptr.is_ai_trainer = false AND ptr.status = 'active';

GRANT SELECT ON client_professional_team TO authenticated;

-- =====================================================
-- SUBSCRIPTION HELPER FUNCTIONS (needed for RLS policies)
-- =====================================================

CREATE OR REPLACE FUNCTION get_user_subscription(p_user_id UUID)
RETURNS TABLE (
    id UUID,
    tier_name TEXT,
    display_name TEXT,
    features JSONB,
    workout_limit INTEGER,
    ai_access BOOLEAN,
    ai_workout_limit INTEGER,
    gym_buddy_access BOOLEAN,
    gym_buddy_can_create_workouts BOOLEAN,
    gym_buddy_can_suggest_workouts BOOLEAN,
    trainer_client_limit INTEGER,
    is_trainer_tier BOOLEAN,
    analytics_access BOOLEAN,
    export_access BOOLEAN,
    is_active BOOLEAN,
    expires_at TIMESTAMPTZ,
    subscription_ends_at TIMESTAMPTZ,
    payment_status TEXT,
    billing_cycle TEXT,
    cancelled_at TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        us.id,
        st.tier_name, 
        st.display_name, 
        st.features, 
        st.workout_limit, 
        st.ai_access,
        st.ai_workout_limit,
        st.gym_buddy_access,
        st.gym_buddy_can_create_workouts,
        st.gym_buddy_can_suggest_workouts,
        st.trainer_client_limit,
        st.is_trainer_tier,
        st.analytics_access,
        st.export_access,
        (us.expires_at IS NULL OR us.expires_at > NOW()) as is_active, 
        us.expires_at,
        -- subscription_ends_at: When the subscription ends (end of billing period)
        -- For cancelled subscriptions, this is when access ends; for active, it's the next expiry
        us.expires_at as subscription_ends_at,
        us.payment_status,
        us.billing_cycle,
        us.cancelled_at
    FROM user_subscriptions us
    JOIN subscription_tiers st ON us.tier_name = st.tier_name
    WHERE us.user_id = p_user_id
    AND (
        -- Active subscriptions (includes cancelled-but-active subscriptions where payment_status is still 'active')
        us.payment_status IN ('active', 'trialing', 'past_due')
        OR
        -- Cancelled subscriptions that haven't expired yet
        (us.payment_status = 'cancelled' AND us.expires_at IS NOT NULL AND us.expires_at > NOW())
    )
    AND (us.expires_at IS NULL OR us.expires_at > NOW())
    ORDER BY us.starts_at DESC
    LIMIT 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION can_user_create_workout(p_user_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
    v_subscription RECORD;
    v_workout_count INTEGER;
BEGIN
    SELECT * INTO v_subscription FROM get_user_subscription(p_user_id) LIMIT 1;
    
    -- Note: In PL/pgSQL, RECORD variables are never NULL after SELECT INTO
    -- Check a specific field instead (tier_name will be NULL if no subscription found)
    IF v_subscription.tier_name IS NULL THEN
        SELECT COUNT(*) INTO v_workout_count
        FROM workouts 
        WHERE created_by = p_user_id;
        RETURN v_workout_count < 3;
    END IF;
    
    IF v_subscription.workout_limit IS NULL THEN
        RETURN true;
    END IF;
    
    SELECT COUNT(*) INTO v_workout_count
    FROM workouts 
    WHERE created_by = p_user_id;
    
    RETURN v_workout_count < v_subscription.workout_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION user_has_ai_access(p_user_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
    v_subscription RECORD;
BEGIN
    SELECT * INTO v_subscription FROM get_user_subscription(p_user_id) LIMIT 1;
    
    -- Check if subscription has AI access or gym buddy access
    -- No addons - users must upgrade their subscription tier to access AI features
    IF v_subscription.ai_access OR v_subscription.gym_buddy_access THEN
        RETURN true;
    END IF;
    
    RETURN false;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION check_trainer_slots(p_trainer_id UUID)
RETURNS JSONB AS $$
DECLARE
    v_max_slots INTEGER;
    v_active_clients INTEGER;
    v_subscription RECORD;
BEGIN
    -- Get subscription tier (single source of truth)
    SELECT * INTO v_subscription FROM get_user_subscription(p_trainer_id) LIMIT 1;
    
    -- Note: In PL/pgSQL, RECORD variables are never NULL after SELECT INTO
    -- Check a specific field instead (tier_name will be NULL if no subscription found)
    IF v_subscription.tier_name IS NOT NULL AND v_subscription.is_trainer_tier = true THEN
        -- Use subscription tier limit
        v_max_slots := v_subscription.trainer_client_limit;
    ELSE
        -- No trainer subscription = no client slots
        v_max_slots := 0;
    END IF;
    
    -- Verify user has an active trainer subscription or role
    IF NOT EXISTS(
        SELECT 1 FROM profiles p
        LEFT JOIN user_subscriptions us ON p.subscription_id = us.id
        LEFT JOIN subscription_tiers st ON us.tier_name = st.tier_name
        WHERE p.id = p_trainer_id
        AND (
            (p.role = 'personal_trainer' OR p.role = 'physiotherapist')
            OR
            (st.is_trainer_tier = true AND us.payment_status IN ('active', 'trialing', 'past_due') AND (us.expires_at IS NULL OR us.expires_at > NOW()))
        )
    ) THEN
        RETURN jsonb_build_object(
            'has_slots', false,
            'error', 'Not a personal trainer/physiotherapist with active trainer subscription',
            'active_clients', 0,
            'max_slots', 0,
            'available_slots', 0
        );
    END IF;
    
    IF v_max_slots IS NULL OR v_max_slots = 0 THEN
        RETURN jsonb_build_object(
            'has_slots', false,
            'error', 'Trainer has no client slots configured',
            'active_clients', 0,
            'max_slots', 0,
            'available_slots', 0
        );
    END IF;
    
    SELECT COUNT(*) INTO v_active_clients
    FROM pt_client_relationships
    WHERE trainer_id = p_trainer_id 
    AND status = 'active'
    AND is_ai_trainer = false;
    
    RETURN jsonb_build_object(
        'has_slots', v_active_clients < v_max_slots,
        'active_clients', v_active_clients,
        'max_slots', v_max_slots,
        'available_slots', GREATEST(0, v_max_slots - v_active_clients)
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
