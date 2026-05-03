-- =====================================================
-- SUBSCRIPTION SYSTEM AND PROFESSIONAL ROLES
-- =====================================================

-- =====================================================
-- INSERT SUBSCRIPTION TIERS
-- =====================================================

-- User Subscription Tiers
INSERT INTO subscription_tiers (
    tier_name, display_name, description, price_monthly, price_yearly, currency,
    workout_limit, ai_access, ai_workout_limit, gym_buddy_access,
    gym_buddy_can_create_workouts, gym_buddy_can_suggest_workouts,
    trainer_client_limit, is_trainer_tier,
    features, analytics_access, export_access
) VALUES
-- Free: 3 workouts max, no AI, no gym buddy
('free', 'Free', 'Basic workout tracking with 3 workout limit. No AI workouts or gym buddy access.', 
 0.00, 0.00, 'GBP',
 3, false, 0, false, false, false, NULL, false,
 '{"workouts": 3, "progress": true}', false, false),
-- Basic: Unlimited workouts, 1 AI workout/month, no gym buddy, no trial
('basic', 'Basic', 'Unlimited workouts and 1 AI-generated workout per month. No gym buddy access.', 
 7.99, 79.99, 'GBP',
 NULL, true, 1, false, false, false, NULL, false,
 '{"workouts": "unlimited", "ai_workouts": 1, "progress": true}', false, false),
-- Premium: Unlimited workouts, 6 AI workouts/month, full gym buddy access, 7-day trial
('premium', 'Premium', 'Unlimited workouts, 6 AI-generated workouts per month, and full gym buddy access.', 
 12.99, 129.99, 'GBP',
 NULL, true, 6, true, true, true, NULL, false,
 '{"workouts": "unlimited", "ai_workouts": 6, "gym_buddy": true, "gym_buddy_can_create": true, "gym_buddy_can_suggest": true, "progress": true}', false, false),
-- Trainer Tiers - Standard (no AI buddy)
-- Individual Trainer Standard: Up to 2 clients, £9.99/month, £99.99/year
('individual_trainer_standard', 'Individual Trainer Standard', 'For individual trainers with up to 2 clients. No AI buddy included.', 
 9.99, 99.99, 'GBP',
 NULL, false, 0, false, false, false, 2, true,
 '{"trainer_clients": 2, "workouts": "unlimited"}', true, true),
-- Small Business Standard: Up to 30 clients, £55/month, £550/year
('small_business_standard', 'Small Business Trainer Standard', 'For small training businesses with up to 30 clients. No AI buddy included.', 
 55.00, 550.00, 'GBP',
 NULL, false, 0, false, false, false, 30, true,
 '{"trainer_clients": 30, "workouts": "unlimited"}', true, true),
-- Medium Enterprise Standard: Up to 500 clients, £200/month, £2000/year
('medium_enterprise_standard', 'Medium to Enterprise Trainer Standard', 'For medium to large training businesses with up to 500 clients. No AI buddy included.', 
 200.00, 2000.00, 'GBP',
 NULL, false, 0, false, false, false, 500, true,
 '{"trainer_clients": 500, "workouts": "unlimited"}', true, true),
-- Trainer Tiers - Pro (includes AI buddy)
-- Individual Trainer Pro: Up to 2 clients, £14.99/month, £149.99/year, 14-day trial
('individual_trainer_pro', 'Individual Trainer Pro', 'For individual trainers with up to 2 clients. Includes AI buddy for client insights and trainer analytics.', 
 14.99, 149.99, 'GBP',
 NULL, false, 0, false, false, false, 2, true,
 '{"trainer_clients": 2, "workouts": "unlimited", "ai_buddy": true}', true, true),
-- Small Business Pro: Up to 30 clients, £75/month, £750/year, 14-day trial
('small_business_pro', 'Small Business Trainer Pro', 'For small training businesses with up to 30 clients. Includes AI buddy for client insights and trainer analytics.', 
 75.00, 750.00, 'GBP',
 NULL, false, 0, false, false, false, 30, true,
 '{"trainer_clients": 30, "workouts": "unlimited", "ai_buddy": true}', true, true),
-- Medium Enterprise Pro: Up to 500 clients, £300/month, £3000/year, 14-day trial
('medium_enterprise_pro', 'Medium to Enterprise Trainer Pro', 'For medium to large training businesses with up to 500 clients. Includes AI buddy for client insights and trainer analytics.', 
 300.00, 3000.00, 'GBP',
 NULL, false, 0, false, false, false, 500, true,
 '{"trainer_clients": 500, "workouts": "unlimited", "ai_buddy": true}', true, true)
ON CONFLICT (tier_name) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    description = EXCLUDED.description,
    price_monthly = EXCLUDED.price_monthly,
    price_yearly = EXCLUDED.price_yearly,
    workout_limit = EXCLUDED.workout_limit,
    ai_access = EXCLUDED.ai_access,
    ai_workout_limit = EXCLUDED.ai_workout_limit,
    gym_buddy_access = EXCLUDED.gym_buddy_access,
    gym_buddy_can_create_workouts = EXCLUDED.gym_buddy_can_create_workouts,
    gym_buddy_can_suggest_workouts = EXCLUDED.gym_buddy_can_suggest_workouts,
    trainer_client_limit = EXCLUDED.trainer_client_limit,
    is_trainer_tier = EXCLUDED.is_trainer_tier,
    features = EXCLUDED.features,
    analytics_access = EXCLUDED.analytics_access,
    export_access = EXCLUDED.export_access;

-- =====================================================
-- SUBSCRIPTION HELPER FUNCTIONS
-- =====================================================
-- Note: get_user_subscription, can_user_create_workout, and user_has_ai_access
-- are defined in 003_functions_and_triggers.sql because they're needed by RLS policies

-- update_subscription_limits: Updates profiles.subscription_id to point to active subscription
-- This implements the single source of truth pattern where all subscription data lives in user_subscriptions

CREATE OR REPLACE FUNCTION update_subscription_limits(p_user_id UUID)
RETURNS VOID AS $$
DECLARE
    v_subscription RECORD;
    v_new_role user_role;
BEGIN
    SELECT * INTO v_subscription FROM get_user_subscription(p_user_id) LIMIT 1;

    -- Determine role and subscription_id based on active subscription
    IF v_subscription.id IS NOT NULL THEN
        -- User has an active subscription
        -- Determine role based on subscription tier
        -- If user has a trainer tier subscription, set role to 'personal_trainer'
        -- Otherwise, keep as 'user' (default role)
        IF v_subscription.is_trainer_tier = true THEN
            v_new_role := 'personal_trainer';
        ELSE
            v_new_role := 'user';
        END IF;

        -- Update with active subscription
        UPDATE profiles SET
            subscription_id = v_subscription.id,
            role = v_new_role
        WHERE id = p_user_id;
    ELSE
        -- No active subscription - set to free tier defaults
        UPDATE profiles SET
            subscription_id = NULL,
            role = 'user'
        WHERE id = p_user_id;
    END IF;
    
    -- Update workout limit (defaults to 3 for free tier when no active subscription)
    INSERT INTO subscription_limits (user_id, limit_type, limit_value)
    VALUES (p_user_id, 'workouts', COALESCE(v_subscription.workout_limit, 3))
    ON CONFLICT (user_id, limit_type)
    DO UPDATE SET
        limit_value = EXCLUDED.limit_value,
        updated_at = NOW();

    -- Update AI workout limit (monthly)
    IF v_subscription.ai_workout_limit IS NOT NULL THEN
        INSERT INTO subscription_limits (user_id, limit_type, limit_value, reset_date)
        VALUES (p_user_id, 'ai_workouts', v_subscription.ai_workout_limit, date_trunc('month', NOW()))
        ON CONFLICT (user_id, limit_type)
        DO UPDATE SET
            limit_value = EXCLUDED.limit_value,
            reset_date = date_trunc('month', NOW()),
            -- Never reset current_count on subscription changes - it represents actual usage
            -- The limit check will naturally prevent usage if current_count >= limit_value
            -- This prevents users from gaining extra workouts when downgrading mid-month
            updated_at = NOW();
    ELSE
        -- No active subscription or subscription doesn't include AI - remove AI limit
        DELETE FROM subscription_limits
        WHERE user_id = p_user_id AND limit_type = 'ai_workouts';
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION check_ai_generation_limit(p_user_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
    v_subscription RECORD;
    v_limit_record RECORD;
BEGIN
    SELECT * INTO v_subscription FROM get_user_subscription(p_user_id) LIMIT 1;
    
    -- If no subscription, return false (free tier)
    -- Note: In PL/pgSQL, RECORD variables are never NULL after SELECT INTO
    -- Check a specific field instead (tier_name will be NULL if no subscription found)
    IF v_subscription.tier_name IS NULL THEN
        RETURN false;
    END IF;
    
    -- If no AI access, return false
    IF NOT v_subscription.ai_access THEN
        RETURN false;
    END IF;
    
    -- If unlimited (NULL), return true
    IF v_subscription.ai_workout_limit IS NULL THEN
        RETURN true;
    END IF;
    
    -- If limit is 0, return false
    IF v_subscription.ai_workout_limit = 0 THEN
        RETURN false;
    END IF;
    
    -- Check current month's usage
    SELECT * INTO v_limit_record
    FROM subscription_limits 
    WHERE user_id = p_user_id 
    AND limit_type = 'ai_workouts'
    AND reset_date >= date_trunc('month', NOW());
    
    -- Note: In PL/pgSQL, RECORD variables are never NULL after SELECT INTO
    -- Check a specific field instead (user_id will be NULL if no record found)
    IF v_limit_record.user_id IS NULL THEN
        -- No record for this month, so user hasn't used any yet
        RETURN true;
    END IF;
    
    -- Check if current count is less than limit
    -- Note: reset_date is already filtered to current month in the query above,
    -- so no need to check it again here
    
    RETURN COALESCE(v_limit_record.current_count, 0) < v_subscription.ai_workout_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- New function: Check if user can generate AI workout (respects monthly limit)
CREATE OR REPLACE FUNCTION can_user_generate_ai_workout(p_user_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN check_ai_generation_limit(p_user_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- New function: Check if user has gym buddy access
CREATE OR REPLACE FUNCTION user_has_gym_buddy_access(p_user_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
    v_subscription RECORD;
BEGIN
    SELECT * INTO v_subscription FROM get_user_subscription(p_user_id) LIMIT 1;
    
    -- Check if subscription includes gym buddy
    -- Note: Check tier_name first to ensure subscription exists (RECORD variables are never NULL)
    -- No addons - users must upgrade their subscription tier to access gym buddy
    IF v_subscription.tier_name IS NOT NULL AND v_subscription.gym_buddy_access THEN
        RETURN true;
    END IF;
    
    RETURN false;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- New function: Check if gym buddy can create workout plans
CREATE OR REPLACE FUNCTION gym_buddy_can_create_workouts(p_user_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
    v_subscription RECORD;
BEGIN
    SELECT * INTO v_subscription FROM get_user_subscription(p_user_id) LIMIT 1;
    
    -- Note: In PL/pgSQL, RECORD variables are never NULL after SELECT INTO
    -- Check a specific field instead (tier_name will be NULL if no subscription found)
    IF v_subscription.tier_name IS NULL THEN
        RETURN false;
    END IF;
    
    RETURN v_subscription.gym_buddy_can_create_workouts = true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- New function: Check if gym buddy can suggest workout swaps
CREATE OR REPLACE FUNCTION gym_buddy_can_suggest_workouts(p_user_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
    v_subscription RECORD;
BEGIN
    SELECT * INTO v_subscription FROM get_user_subscription(p_user_id) LIMIT 1;
    
    -- Note: In PL/pgSQL, RECORD variables are never NULL after SELECT INTO
    -- Check a specific field instead (tier_name will be NULL if no subscription found)
    IF v_subscription.tier_name IS NULL THEN
        RETURN false;
    END IF;
    
    RETURN v_subscription.gym_buddy_can_suggest_workouts = true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION increment_usage_limit(p_user_id UUID, p_limit_type TEXT)
RETURNS VOID AS $$
DECLARE
    v_current_month_start TIMESTAMPTZ;
BEGIN
    v_current_month_start := date_trunc('month', NOW());
    
    -- Insert or update with current month's reset_date
    INSERT INTO subscription_limits (user_id, limit_type, current_count, reset_date)
    VALUES (p_user_id, p_limit_type, 1, v_current_month_start)
    ON CONFLICT (user_id, limit_type) 
    DO UPDATE SET 
        -- Only increment if reset_date is for current month, otherwise reset to 1
        current_count = CASE 
            WHEN subscription_limits.reset_date >= v_current_month_start 
            THEN subscription_limits.current_count + 1
            ELSE 1
        END,
        reset_date = CASE 
            WHEN subscription_limits.reset_date >= v_current_month_start 
            THEN subscription_limits.reset_date
            ELSE v_current_month_start
        END,
        updated_at = NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION decrement_usage_limit(p_user_id UUID, p_limit_type TEXT)
RETURNS VOID AS $$
DECLARE
    v_current_month_start TIMESTAMPTZ;
BEGIN
    v_current_month_start := date_trunc('month', NOW());

    -- Update current count (only decrement if for current month)
    UPDATE subscription_limits
    SET current_count = GREATEST(0, current_count - 1),
        updated_at = NOW()
    WHERE user_id = p_user_id
      AND limit_type = p_limit_type
      AND reset_date >= v_current_month_start;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION try_consume_workout_allowance(p_user_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
    v_subscription RECORD;
    v_current_month_start TIMESTAMPTZ;
    v_rows_affected INTEGER;
BEGIN
    v_current_month_start := date_trunc('month', NOW());

    -- Get user's subscription
    SELECT * INTO v_subscription FROM get_user_subscription(p_user_id) LIMIT 1;

    -- CRITICAL: Check if user has a valid subscription with AI access
    -- This prevents unlimited access for users without subscriptions
    IF v_subscription.tier_name IS NULL OR NOT v_subscription.ai_access THEN
        RETURN FALSE;
    END IF;

    -- Check allowance and consume atomically to prevent race conditions
    IF v_subscription.ai_workout_limit IS NULL THEN
        -- Unlimited - always allow, but still track usage for analytics
        PERFORM increment_usage_limit(p_user_id, 'ai_workouts');
        RETURN TRUE;
    ELSIF v_subscription.ai_workout_limit = 0 THEN
        -- No allowance - never allow
        RETURN FALSE;
    ELSE
        -- Atomic check and consume using SELECT FOR UPDATE
        SELECT 1 INTO v_rows_affected
        FROM subscription_limits
        WHERE user_id = p_user_id
          AND limit_type = 'ai_workouts'
          AND reset_date >= v_current_month_start
          AND current_count < v_subscription.ai_workout_limit
        FOR UPDATE;

        IF FOUND THEN
            -- Can consume - increment atomically
            UPDATE subscription_limits
            SET current_count = current_count + 1,
                updated_at = NOW()
            WHERE user_id = p_user_id
              AND limit_type = 'ai_workouts'
              AND reset_date >= v_current_month_start;
            RETURN TRUE;
        ELSE
            -- Check if we can create a new record (first use this month)
            SELECT 1 INTO v_rows_affected
            FROM subscription_limits
            WHERE user_id = p_user_id
              AND limit_type = 'ai_workouts'
              AND reset_date >= v_current_month_start;

            IF NOT FOUND AND v_subscription.ai_workout_limit > 0 THEN
                -- No record exists, create one with count = 1
                INSERT INTO subscription_limits (user_id, limit_type, current_count, reset_date)
                VALUES (p_user_id, 'ai_workouts', 1, v_current_month_start);
                RETURN TRUE;
            END IF;
        END IF;

        RETURN FALSE;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION reset_monthly_limits()
RETURNS VOID AS $$
BEGIN
    UPDATE subscription_limits
    SET current_count = 0, reset_date = NOW(), updated_at = NOW()
    WHERE reset_date < date_trunc('month', NOW());
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION user_can_access_feature(p_user_id UUID, p_feature TEXT)
RETURNS BOOLEAN AS $$
DECLARE
    v_subscription RECORD;
    v_profile RECORD;
BEGIN
    SELECT * INTO v_subscription FROM get_user_subscription(p_user_id) LIMIT 1;
    
    -- Note: In PL/pgSQL, RECORD variables are never NULL after SELECT INTO
    -- Check a specific field instead (tier_name will be NULL if no subscription found)
    IF v_subscription.tier_name IS NULL THEN
        -- Free tier: check basic features only
        CASE p_feature
            WHEN 'unlimited_workouts' THEN RETURN false; -- Free tier has 3 workout limit
            WHEN 'ai_generation' THEN RETURN false; -- Free tier has no AI
            WHEN 'ai_workout_generation' THEN RETURN false;
            WHEN 'gym_buddy' THEN RETURN false; -- Free tier has no gym buddy
            WHEN 'gym_buddy_create_workouts' THEN RETURN false;
            WHEN 'gym_buddy_suggest_workouts' THEN RETURN false;
            WHEN 'workout_sharing' THEN RETURN false; -- Free tier cannot share workouts
            WHEN 'advanced_analytics' THEN RETURN false;
            WHEN 'data_export' THEN RETURN false;
            ELSE RETURN false;
        END CASE;
    ELSE
        CASE p_feature
            WHEN 'unlimited_workouts' THEN RETURN v_subscription.workout_limit IS NULL;
            WHEN 'ai_generation' THEN RETURN v_subscription.ai_access = true;
            WHEN 'ai_workout_generation' THEN RETURN check_ai_generation_limit(p_user_id);
            WHEN 'gym_buddy' THEN RETURN user_has_gym_buddy_access(p_user_id); -- Check subscription tier only
            WHEN 'gym_buddy_create_workouts' THEN RETURN v_subscription.gym_buddy_can_create_workouts = true;
            WHEN 'gym_buddy_suggest_workouts' THEN RETURN v_subscription.gym_buddy_can_suggest_workouts = true;
            WHEN 'workout_sharing' THEN RETURN v_subscription.tier_name IN ('basic', 'premium');
            WHEN 'advanced_analytics' THEN RETURN v_subscription.analytics_access = true;
            WHEN 'data_export' THEN RETURN v_subscription.export_access = true;
            ELSE RETURN false;
        END CASE;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- SUBSCRIPTION TRIGGERS
-- =====================================================

CREATE OR REPLACE FUNCTION trigger_update_subscription_limits()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM update_subscription_limits(NEW.user_id);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_subscription_limits_trigger ON user_subscriptions;
CREATE TRIGGER update_subscription_limits_trigger
    AFTER INSERT OR UPDATE ON user_subscriptions
    FOR EACH ROW
    EXECUTE FUNCTION trigger_update_subscription_limits();

-- Addon trigger removed: Addons no longer affect subscription limits
-- Users must upgrade their subscription tier to access features like gym buddy

CREATE OR REPLACE FUNCTION trigger_increment_workout_limit()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM increment_usage_limit(NEW.created_by, 'workouts');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS increment_workout_limit_trigger ON workouts;
CREATE TRIGGER increment_workout_limit_trigger
    AFTER INSERT ON workouts
    FOR EACH ROW
    EXECUTE FUNCTION trigger_increment_workout_limit();

CREATE OR REPLACE FUNCTION trigger_increment_ai_limit()
RETURNS TRIGGER AS $$
BEGIN
    -- Only increment AI workout limit for workout generation, not gym buddy chat
    -- Workout generation is identified by having a workout_id in the context JSONB
    -- Gym buddy conversations don't have workout_id in context
    IF NEW.context IS NOT NULL AND NEW.context->>'workout_id' IS NOT NULL THEN
        -- This is an AI workout generation, increment the limit
        PERFORM increment_usage_limit(NEW.user_id, 'ai_workouts');
    END IF;
    -- If no workout_id in context, this is gym buddy chat - don't increment limit
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS increment_ai_limit_trigger ON ai_conversations;
CREATE TRIGGER increment_ai_limit_trigger
    AFTER INSERT ON ai_conversations
    FOR EACH ROW
    WHEN (NEW.role = 'assistant')
    EXECUTE FUNCTION trigger_increment_ai_limit();

-- =====================================================
-- PROFESSIONAL ROLE FUNCTIONS
-- =====================================================
-- Note: check_trainer_slots is defined in 003_functions_and_triggers.sql
-- because it's needed by RLS policies

CREATE OR REPLACE FUNCTION check_professional_slots(p_user_id UUID, p_role_type user_role)
RETURNS BOOLEAN AS $$
DECLARE
    v_subscription RECORD;
    v_current_slots INTEGER;
    v_max_slots INTEGER;
    v_has_role BOOLEAN;
BEGIN
    -- Verify user has the specified professional role
    SELECT EXISTS(
        SELECT 1 FROM profiles
        WHERE id = p_user_id AND role = p_role_type
    ) INTO v_has_role;

    IF NOT v_has_role THEN
        RETURN false; -- User doesn't have the required role
    END IF;
    
    -- Get subscription tier (single source of truth)
    SELECT * INTO v_subscription FROM get_user_subscription(p_user_id) LIMIT 1;
    
    -- Note: Check tier_name instead of IS NOT NULL (RECORD variables are never NULL)
    IF v_subscription.tier_name IS NOT NULL AND v_subscription.is_trainer_tier = true THEN
        v_max_slots := v_subscription.trainer_client_limit;
    ELSE
        -- No trainer subscription = no client slots
        v_max_slots := 0;
    END IF;
    
    -- Check for NULL/zero after both branches (consistent with check_trainer_slots)
    -- This handles cases where trainer_client_limit might be NULL even for trainer tiers
    IF v_max_slots IS NULL OR v_max_slots = 0 THEN
        RETURN false;
    END IF;
    
    SELECT COUNT(*) INTO v_current_slots
    FROM pt_client_relationships 
    WHERE trainer_id = p_user_id 
    AND status = 'active'
    AND is_ai_trainer = false;
    
    RETURN v_current_slots < v_max_slots;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION has_active_professional_role(p_user_id UUID, p_role_type user_role)
RETURNS BOOLEAN AS $$
DECLARE
    v_has_role BOOLEAN;
    v_subscription RECORD;
BEGIN
    -- Verify user has the specified professional role
    SELECT EXISTS(
        SELECT 1 FROM profiles
        WHERE id = p_user_id AND role = p_role_type
    ) INTO v_has_role;

    IF NOT v_has_role THEN
        RETURN false;
    END IF;
    
    -- Check if user has an active trainer subscription tier
    SELECT * INTO v_subscription FROM get_user_subscription(p_user_id) LIMIT 1;

    -- Return true if they have a trainer tier subscription, OR
    -- they have the professional role (free trainers are considered active)
    RETURN v_subscription.tier_name IS NOT NULL AND v_subscription.is_trainer_tier = true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION get_user_professional_roles(p_user_id UUID)
RETURNS TABLE (
    role_type user_role,
    tier TEXT,
    max_slots INTEGER,
    expires_at TIMESTAMPTZ
) AS $$
DECLARE
    v_subscription RECORD;
    v_profile RECORD;
BEGIN
    -- Get subscription tier (single source of truth)
    SELECT * INTO v_subscription FROM get_user_subscription(p_user_id) LIMIT 1;
    
    -- Get profile to determine role
    SELECT role INTO v_profile FROM profiles WHERE id = p_user_id;

    -- Only return trainer info if user has a trainer subscription tier
    -- Free trainers no longer get client slots in the new architecture
    IF v_subscription.tier_name IS NOT NULL AND v_subscription.is_trainer_tier = true THEN
        -- Return the role from the profile
        RETURN QUERY
        SELECT
            v_profile.role as role_type,
            v_subscription.tier_name as tier,
            v_subscription.trainer_client_limit as max_slots,
            v_subscription.expires_at;
        END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION professionals_share_client(p_professional1_id UUID, p_professional2_id UUID)
RETURNS TABLE (
    shared_client_id UUID,
    client_name TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT DISTINCT ptr1.client_id as shared_client_id, p.full_name as client_name
    FROM pt_client_relationships ptr1
    JOIN pt_client_relationships ptr2 ON ptr1.client_id = ptr2.client_id
    JOIN profiles p ON p.id = ptr1.client_id
    WHERE ptr1.trainer_id = p_professional1_id
    AND ptr2.trainer_id = p_professional2_id
    AND ptr1.status = 'active'
    AND ptr2.status = 'active'
    AND ptr1.is_ai_trainer = false
    AND ptr2.is_ai_trainer = false;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION get_shared_client_context(p_professional_id UUID, p_client_id UUID)
RETURNS JSONB AS $$
DECLARE
    v_result JSONB;
BEGIN
    SELECT jsonb_build_object(
        'client', jsonb_build_object(
            'id', p.id, 'name', p.full_name, 'email', p.email,
            'fitness_level', p.fitness_level, 'primary_goal', gt.name
        ),
        'my_relationship', jsonb_build_object(
            'role', mp.role, 'is_pt', (mp.role = 'personal_trainer'),
            'is_physio', (mp.role = 'physiotherapist'), 'reason', my_rel.relationship_reason,
            'since', my_rel.created_at
        ),
        'other_professionals', (
            SELECT jsonb_agg(jsonb_build_object(
                'id', op.id, 'name', op.full_name, 'role', op.role,
                'is_pt', (op.role = 'personal_trainer'), 'is_physio', (op.role = 'physiotherapist'),
                'reason', other_rel.relationship_reason, 'since', other_rel.created_at
            ))
            FROM pt_client_relationships other_rel
            JOIN profiles op ON op.id = other_rel.trainer_id
            WHERE other_rel.client_id = p_client_id
            AND other_rel.trainer_id != p_professional_id
            AND other_rel.status = 'active'
            AND other_rel.is_ai_trainer = false
        )
    )
    INTO v_result
    FROM profiles p
    LEFT JOIN goal_types gt ON gt.id = p.primary_goal_id
    JOIN pt_client_relationships my_rel ON my_rel.client_id = p.id
    JOIN profiles mp ON mp.id = my_rel.trainer_id
    WHERE p.id = p_client_id
    AND my_rel.trainer_id = p_professional_id
    AND my_rel.status = 'active';
    
    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION create_ai_trainer_subscription(p_user_id UUID)
RETURNS UUID AS $$
DECLARE
    v_relationship_id UUID;
BEGIN
    INSERT INTO pt_client_relationships (
        trainer_id, client_id, status, is_ai_trainer
    ) VALUES (
        p_user_id, p_user_id, 'active', true
    )
    RETURNING id INTO v_relationship_id;
    
    RETURN v_relationship_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION cancel_ai_trainer_subscription(p_user_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
    v_deleted_count INTEGER;
BEGIN
    WITH deleted AS (
        DELETE FROM pt_client_relationships
        WHERE client_id = p_user_id AND is_ai_trainer = true
        RETURNING id
    )
    SELECT COUNT(*) INTO v_deleted_count FROM deleted;
    
    RETURN v_deleted_count > 0;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION setup_subscription(
    p_user_id UUID,
    p_selected_role TEXT,
    p_subscription_tier TEXT DEFAULT 'free'
)
RETURNS BOOLEAN AS $$
DECLARE
    v_role user_role;
    v_tier_record RECORD;
BEGIN
    BEGIN
        v_role := p_selected_role::user_role;
    EXCEPTION
        WHEN invalid_text_representation THEN
            RAISE EXCEPTION 'Invalid role: %', p_selected_role;
    END;
    
    SELECT * INTO v_tier_record 
    FROM subscription_tiers 
    WHERE tier_name = p_subscription_tier;
    
    -- Note: In PL/pgSQL, RECORD variables are never NULL after SELECT INTO
    -- Check a specific field instead (tier_name will be NULL if no tier found)
    IF v_tier_record.tier_name IS NULL THEN
        RAISE EXCEPTION 'Invalid subscription tier: %', p_subscription_tier;
    END IF;
    
    -- Update role only - subscription data managed by single source of truth
    UPDATE profiles SET
        role = v_role,
        updated_at = NOW()
    WHERE id = p_user_id;
    
    IF p_subscription_tier != 'free' THEN
        INSERT INTO user_subscriptions (
            user_id, tier_name, payment_status, starts_at, billing_cycle
        ) VALUES (
            p_user_id, p_subscription_tier, 'pending', NOW(), 'monthly'
        );
    END IF;
    
    -- Note: professional_subscriptions table is deprecated
    -- Trainer limits are now managed via subscription_tiers.trainer_client_limit
    -- slot limits are determined by subscription tier
    
    PERFORM update_subscription_limits(p_user_id);
    
    RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION get_role_setup_status(p_user_id UUID)
RETURNS JSONB AS $$
DECLARE
    v_profile RECORD;
    v_subscription RECORD;
BEGIN
    SELECT role INTO v_profile FROM profiles WHERE id = p_user_id;

    SELECT * INTO v_subscription FROM get_user_subscription(p_user_id) LIMIT 1;

    -- Return subscription data from the single source of truth
    RETURN jsonb_build_object(
        'role', v_profile.role,
        'current_tier', COALESCE(v_subscription.tier_name, 'free'),
        'subscription_status', COALESCE(v_subscription.payment_status, 'active'),
        'ai_trainer_enabled', COALESCE(v_subscription.gym_buddy_access, false) OR
                            COALESCE(v_subscription.ai_access, false),
        'workout_limit', COALESCE(v_subscription.workout_limit, 3),
        'subscription_details', CASE
            WHEN v_subscription.tier_name IS NOT NULL THEN to_jsonb(v_subscription)
            ELSE NULL
        END
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- TRAINER SLOT LIMIT TRIGGER
-- =====================================================

CREATE OR REPLACE FUNCTION check_trainer_slot_limit()
RETURNS TRIGGER AS $$
DECLARE
    v_slot_check JSONB;
BEGIN
    IF NEW.is_ai_trainer = true THEN
        RETURN NEW;
    END IF;
    
    IF NEW.status != 'active' THEN
        RETURN NEW;
    END IF;
    
    IF (TG_OP = 'INSERT' AND NEW.status = 'active') 
       OR (TG_OP = 'UPDATE' AND OLD.status != 'active' AND NEW.status = 'active') THEN
        
        v_slot_check := check_trainer_slots(NEW.trainer_id);
        
        IF (v_slot_check->>'has_slots')::boolean = false THEN
            RAISE EXCEPTION 'Trainer has no available client slots. Current: % / Max: %', 
                (v_slot_check->>'active_clients')::integer,
                (v_slot_check->>'max_slots')::integer;
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS enforce_trainer_slot_limit ON pt_client_relationships;
CREATE TRIGGER enforce_trainer_slot_limit
    BEFORE INSERT OR UPDATE ON pt_client_relationships
    FOR EACH ROW
    EXECUTE FUNCTION check_trainer_slot_limit();

-- =====================================================
-- SYSTEM USER CREATION
-- =====================================================

INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data
) VALUES (
    '00000000-0000-0000-0000-000000000000'::uuid,
    '00000000-0000-0000-0000-000000000000'::uuid,
    'authenticated', 'authenticated', 'system@persistence.app',
    '$2a$10$dummy.hash.for.system.user',
    NOW(), NOW(),
    '{"provider": "system", "providers": ["system"]}',
    '{"name": "System", "role": "system"}'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO profiles (
    id, email, full_name, role,
    created_at, updated_at
) VALUES (
    '00000000-0000-0000-0000-000000000000'::uuid,
    'system@persistence.app', 'System', 'user',
    NOW(), NOW()
) ON CONFLICT (id) DO NOTHING;

-- =====================================================
-- COMMENTS
-- =====================================================

COMMENT ON FUNCTION get_user_subscription IS 'Returns user''s current active subscription details';

COMMENT ON FUNCTION can_user_create_workout IS 'Checks if user can create another workout based on subscription';
COMMENT ON FUNCTION user_has_ai_access IS 'Checks if user has AI workout generation access';
COMMENT ON FUNCTION update_subscription_limits IS 'Updates user profile and limits based on subscription';
COMMENT ON FUNCTION check_ai_generation_limit IS 'Checks if user can generate AI content within limits';
COMMENT ON FUNCTION increment_usage_limit IS 'Increments usage counter for a specific limit type';
COMMENT ON FUNCTION reset_monthly_limits IS 'Resets monthly usage limits for all users';
COMMENT ON FUNCTION user_can_access_feature IS 'Checks if user can access a specific feature based on subscription';
COMMENT ON FUNCTION check_trainer_slots IS 'Check if a PT or Physiotherapist has available client slots';
COMMENT ON FUNCTION check_professional_slots IS 'Checks if a professional has available client slots based on their subscription, excluding AI trainer relationships';
COMMENT ON FUNCTION has_active_professional_role IS 'Checks if user has an active professional role with paid subscription';
COMMENT ON FUNCTION get_user_professional_roles IS 'Returns all active professional roles for a user';
COMMENT ON FUNCTION professionals_share_client IS 'Returns shared clients between two professionals';
COMMENT ON FUNCTION get_shared_client_context IS 'Returns complete context about a shared client including all professionals working with them';
COMMENT ON FUNCTION create_ai_trainer_subscription IS 'Creates an AI trainer subscription for a user';
COMMENT ON FUNCTION cancel_ai_trainer_subscription IS 'Cancels AI trainer subscription for a user';
COMMENT ON FUNCTION setup_subscription IS 'Sets up user subscription tier and role configuration';
COMMENT ON FUNCTION get_role_setup_status IS 'Returns the current role setup status and subscription info';
COMMENT ON FUNCTION can_user_generate_ai_workout IS 'Checks if user can generate an AI workout based on monthly limit';
COMMENT ON FUNCTION user_has_gym_buddy_access IS 'Checks if user has access to gym buddy chatbot';
COMMENT ON FUNCTION gym_buddy_can_create_workouts IS 'Checks if gym buddy can create workout plans for user';
COMMENT ON FUNCTION gym_buddy_can_suggest_workouts IS 'Checks if gym buddy can suggest workout swaps/modifications';

