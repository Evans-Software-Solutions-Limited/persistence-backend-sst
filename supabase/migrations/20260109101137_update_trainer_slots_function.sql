-- Fix subscription synchronization: Update profiles and trainer slots
-- This migration ensures all existing subscriptions have correct profile roles

-- Update profile roles for active trainer subscriptions
UPDATE profiles
SET role = 'personal_trainer'
WHERE id IN (
  SELECT DISTINCT us.user_id
  FROM user_subscriptions us
  JOIN subscription_tiers st ON us.tier_name = st.tier_name
  WHERE st.is_trainer_tier = true
  AND us.payment_status IN ('active', 'trialing', 'past_due')
  AND (us.expires_at IS NULL OR us.expires_at > NOW())
);

-- Update check_trainer_slots function to accept users with active trainer subscriptions
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

    -- Verify user has an active trainer subscription
    -- Note: Profile roles are now updated automatically by database triggers
    IF NOT EXISTS(
        SELECT 1 FROM profiles p
        LEFT JOIN user_subscriptions us ON p.subscription_id = us.id
        LEFT JOIN subscription_tiers st ON us.tier_name = st.tier_name
        WHERE p.id = p_trainer_id
        AND st.is_trainer_tier = true
        AND us.payment_status IN ('active', 'trialing', 'past_due')
        AND (us.expires_at IS NULL OR us.expires_at > NOW())
    ) THEN
        RETURN jsonb_build_object(
            'has_slots', false,
            'error', 'No active trainer subscription found',
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
