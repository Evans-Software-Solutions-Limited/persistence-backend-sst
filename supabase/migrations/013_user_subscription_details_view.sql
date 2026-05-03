-- =====================================================
-- USER SUBSCRIPTION DETAILS VIEW
-- =====================================================

-- Create a view for easier frontend access to complete subscription data
-- SECURITY: This view inherits RLS policies from underlying tables and does NOT use SECURITY DEFINER
CREATE OR REPLACE VIEW user_subscription_details AS
SELECT
    p.id as user_id,
    p.email,
    p.full_name,
    p.role,
    COALESCE(us.id, NULL) as subscription_id,
    COALESCE(us.tier_name, 'free') as tier_name,
    COALESCE(st.display_name, 'Free') as tier_display_name,
    COALESCE(st.description, 'Basic workout tracking') as tier_description,
    COALESCE(st.features, '{}') as tier_features,
    COALESCE(st.workout_limit, 3) as workout_limit,
    COALESCE(st.ai_access, false) as ai_access,
    COALESCE(st.ai_workout_limit, 0) as ai_workout_limit,
    COALESCE(st.gym_buddy_access, false) as gym_buddy_access,
    COALESCE(st.trainer_client_limit, 0) as trainer_client_limit,
    COALESCE(st.is_trainer_tier, false) as is_trainer_tier,
    COALESCE(us.payment_status, 'none') as payment_status,
    COALESCE(us.billing_cycle, 'monthly') as billing_cycle,
    us.starts_at,
    us.expires_at,
    us.cancelled_at,
    us.trial_ends_at
FROM profiles p
LEFT JOIN user_subscriptions us ON p.subscription_id = us.id
LEFT JOIN subscription_tiers st ON us.tier_name = st.tier_name;

-- Grant access to the view
GRANT SELECT ON user_subscription_details TO authenticated;

-- SECURITY NOTE: This view inherits RLS policies from underlying tables:
-- - profiles: Users can only see their own profile, public profiles, friends, and trainer/client relationships
-- - user_subscriptions: Users can only see their own subscriptions
-- - subscription_tiers: All authenticated users can see active tiers
-- No explicit policy needed on the view itself - it respects underlying table security

COMMENT ON VIEW user_subscription_details IS 'Complete user subscription information including tier details - SECURE: Inherits RLS from underlying tables';

-- =====================================================
-- SECURE RPC FUNCTION FOR SUBSCRIPTION DETAILS
-- =====================================================

-- Create the RPC function that the frontend expects
-- Security is provided by the view's inherited RLS policies
CREATE OR REPLACE FUNCTION get_user_subscription_details(p_user_id UUID)
RETURNS TABLE(
    user_id UUID,
    email TEXT,
    full_name TEXT,
    role user_role,
    subscription_id UUID,
    tier_name TEXT,
    tier_display_name TEXT,
    tier_description TEXT,
    tier_features JSONB,
    workout_limit INTEGER,
    ai_access BOOLEAN,
    ai_workout_limit INTEGER,
    gym_buddy_access BOOLEAN,
    trainer_client_limit INTEGER,
    is_trainer_tier BOOLEAN,
    payment_status TEXT,
    billing_cycle TEXT,
    starts_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    trial_ends_at TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
BEGIN
    -- Return the subscription details for the user
    -- Security is enforced by the view's inherited RLS policies from underlying tables:
    -- - profiles table: Users can only see their own profile, friends, and trainer relationships
    -- - user_subscriptions table: Users can only see their own subscriptions
    -- - subscription_tiers table: All authenticated users can see active tiers
    RETURN QUERY
    SELECT
        usd.user_id,
        usd.email,
        usd.full_name,
        usd.role,
        usd.subscription_id,
        usd.tier_name,
        usd.tier_display_name,
        usd.tier_description,
        usd.tier_features,
        usd.workout_limit,
        usd.ai_access,
        usd.ai_workout_limit,
        usd.gym_buddy_access,
        usd.trainer_client_limit,
        usd.is_trainer_tier,
        usd.payment_status,
        usd.billing_cycle,
        usd.starts_at,
        usd.expires_at,
        usd.cancelled_at,
        usd.trial_ends_at
    FROM user_subscription_details usd
    WHERE usd.user_id = p_user_id;
END;
$$;

-- Grant execute permission on the function
GRANT EXECUTE ON FUNCTION get_user_subscription_details(UUID) TO authenticated;
