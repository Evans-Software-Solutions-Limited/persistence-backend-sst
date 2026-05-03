-- =====================================================
-- ADMIN PRICING MANAGEMENT
-- =====================================================

-- =====================================================
-- FUNCTION: UPDATE SUBSCRIPTION PRICING (ADMIN ONLY)
-- =====================================================

CREATE OR REPLACE FUNCTION update_subscription_pricing(
    p_tier_name TEXT,
    p_price_monthly DECIMAL(10,2) DEFAULT NULL,
    p_price_yearly DECIMAL(10,2) DEFAULT NULL,
    p_currency TEXT DEFAULT 'GBP',
    p_change_reason TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_admin_id UUID;
    v_tier RECORD;
    v_old_monthly DECIMAL(10,2);
    v_old_yearly DECIMAL(10,2);
    v_new_monthly DECIMAL(10,2);
    v_new_yearly DECIMAL(10,2);
BEGIN
    -- Get current user (must be admin)
    v_admin_id := auth.uid();
    
    IF v_admin_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;
    
    -- Check if user is admin
    IF NOT EXISTS (
        SELECT 1 FROM profiles
        WHERE id = v_admin_id
        AND role = 'admin'
    ) THEN
        RAISE EXCEPTION 'Admin access required';
    END IF;
    
    -- Get current tier
    SELECT * INTO v_tier
    FROM subscription_tiers
    WHERE tier_name = p_tier_name;
    
    IF v_tier IS NULL THEN
        RAISE EXCEPTION 'Subscription tier not found: %', p_tier_name;
    END IF;
    
    -- Store old values
    v_old_monthly := v_tier.price_monthly;
    v_old_yearly := v_tier.price_yearly;
    
    -- Determine new values (only update if provided)
    v_new_monthly := COALESCE(p_price_monthly, v_old_monthly);
    v_new_yearly := COALESCE(p_price_yearly, v_old_yearly);
    
    -- Validate prices
    IF v_new_monthly < 0 OR v_new_yearly < 0 THEN
        RAISE EXCEPTION 'Prices cannot be negative';
    END IF;
    
    -- Only proceed if prices actually changed
    IF v_new_monthly = v_old_monthly AND v_new_yearly = v_old_yearly THEN
        RETURN jsonb_build_object(
            'success', true,
            'message', 'No price changes',
            'prices', jsonb_build_object(
                'monthly', v_old_monthly,
                'yearly', v_old_yearly,
                'currency', p_currency
            )
        );
    END IF;
    
    -- Record price history BEFORE updating
    INSERT INTO subscription_price_history (
        tier_name,
        price_monthly_old,
        price_monthly_new,
        price_yearly_old,
        price_yearly_new,
        currency,
        changed_by,
        change_reason
    ) VALUES (
        p_tier_name,
        v_old_monthly,
        v_new_monthly,
        v_old_yearly,
        v_new_yearly,
        p_currency,
        v_admin_id,
        p_change_reason
    );
    
    -- Update subscription tier
    UPDATE subscription_tiers
    SET 
        price_monthly = v_new_monthly,
        price_yearly = v_new_yearly,
        currency = p_currency,
        updated_at = NOW()
    WHERE tier_name = p_tier_name;
    
    RETURN jsonb_build_object(
        'success', true,
        'message', 'Pricing updated successfully',
        'tier', p_tier_name,
        'old_prices', jsonb_build_object(
            'monthly', v_old_monthly,
            'yearly', v_old_yearly
        ),
        'new_prices', jsonb_build_object(
            'monthly', v_new_monthly,
            'yearly', v_new_yearly,
            'currency', p_currency
        )
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION update_subscription_pricing IS 'Admin-only function to update subscription tier pricing. Records audit trail in subscription_price_history.';

-- =====================================================
-- FUNCTION: GET PRICING HISTORY
-- =====================================================

CREATE OR REPLACE FUNCTION get_pricing_history(
    p_tier_name TEXT DEFAULT NULL,
    p_limit INTEGER DEFAULT 100
)
RETURNS TABLE (
    id UUID,
    tier_name TEXT,
    price_monthly_old DECIMAL(10,2),
    price_monthly_new DECIMAL(10,2),
    price_yearly_old DECIMAL(10,2),
    price_yearly_new DECIMAL(10,2),
    currency TEXT,
    changed_by UUID,
    changed_by_name TEXT,
    change_reason TEXT,
    changed_at TIMESTAMPTZ
) AS $$
DECLARE
    v_current_user_id UUID;
BEGIN
    -- Get current authenticated user
    v_current_user_id := auth.uid();
    
    IF v_current_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;
    
    -- Check if user is admin
    IF NOT EXISTS (
        SELECT 1 FROM profiles
        WHERE id = v_current_user_id
        AND role = 'admin'
    ) THEN
        RAISE EXCEPTION 'Admin access required';
    END IF;
    
    RETURN QUERY
    SELECT 
        sph.id,
        sph.tier_name,
        sph.price_monthly_old,
        sph.price_monthly_new,
        sph.price_yearly_old,
        sph.price_yearly_new,
        sph.currency,
        sph.changed_by,
        p.full_name as changed_by_name,
        sph.change_reason,
        sph.changed_at
    FROM subscription_price_history sph
    LEFT JOIN profiles p ON p.id = sph.changed_by
    WHERE (p_tier_name IS NULL OR sph.tier_name = p_tier_name)
    ORDER BY sph.changed_at DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION get_pricing_history IS 'Returns pricing history for audit trail. Admin-only access enforced via function-level authorization check.';

-- =====================================================
-- FUNCTION: GET USER SUBSCRIPTION HISTORY (FOR DISCOUNTS)
-- =====================================================

CREATE OR REPLACE FUNCTION get_user_subscription_history(
    p_user_id UUID
)
RETURNS TABLE (
    subscription_id UUID,
    tier_name TEXT,
    starts_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    payment_status TEXT,
    total_months INTEGER,
    total_amount_paid DECIMAL(10,2)
) AS $$
DECLARE
    v_current_user_id UUID;
    v_is_admin BOOLEAN;
BEGIN
    -- Get current authenticated user
    v_current_user_id := auth.uid();
    
    IF v_current_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;
    
    -- Check if user is admin
    SELECT EXISTS (
        SELECT 1 FROM profiles
        WHERE id = v_current_user_id
        AND role = 'admin'
    ) INTO v_is_admin;
    
    -- Verify that the caller owns the user_id OR is an admin
    IF v_current_user_id != p_user_id AND NOT v_is_admin THEN
        RAISE EXCEPTION 'Unauthorized: Cannot access other users subscription history';
    END IF;
    
    RETURN QUERY
    SELECT 
        us.id as subscription_id,
        us.tier_name,
        us.starts_at,
        us.expires_at,
        us.cancelled_at,
        us.payment_status,
        -- Calculate total months (for loyalty discounts)
        CASE 
            WHEN us.expires_at IS NOT NULL AND us.starts_at IS NOT NULL THEN
                EXTRACT(EPOCH FROM (us.expires_at - us.starts_at)) / 2592000 -- seconds to months
            ELSE 0
        END::INTEGER as total_months,
        -- Calculate total amount paid using historical prices multiplied by subscription duration
        -- Uses subscription_price_history to find the price active at subscription start time
        -- Falls back to current price if no historical data exists
        -- Multiplies per-period price by number of periods (months or years) to get total paid
        -- Note: If subscription started before any price changes were recorded, current price is used
        -- For accurate historical totals, ensure initial prices are recorded in subscription_price_history
        -- when tiers are created, or store price_paid in user_subscriptions at subscription time
        CASE 
            WHEN us.tier_name = 'free' THEN 0
            WHEN us.billing_cycle = 'monthly' THEN
                -- Calculate months subscribed (use expires_at if available, otherwise use current date)
                (CASE 
                    WHEN us.expires_at IS NOT NULL AND us.starts_at IS NOT NULL THEN
                        EXTRACT(EPOCH FROM (us.expires_at - us.starts_at)) / 2592000
                    WHEN us.starts_at IS NOT NULL THEN
                        EXTRACT(EPOCH FROM (NOW() - us.starts_at)) / 2592000
                    ELSE 0
                END::INTEGER) *
                -- Get per-month price (historical or current)
                COALESCE(
                    (SELECT price_monthly_new 
                     FROM subscription_price_history 
                     WHERE tier_name = us.tier_name 
                     AND changed_at <= us.starts_at
                     ORDER BY changed_at DESC 
                     LIMIT 1),
                    (SELECT price_monthly FROM subscription_tiers WHERE tier_name = us.tier_name),
                    0
                )
            WHEN us.billing_cycle = 'yearly' THEN
                -- For yearly subscriptions, calculate number of full years and multiply by yearly price
                -- Yearly subscriptions are typically paid upfront, so we count complete billing periods
                -- For active subscriptions without expiry, assume at least 1 year was paid (upfront payment)
                GREATEST(
                    CASE 
                        WHEN us.expires_at IS NOT NULL AND us.starts_at IS NOT NULL THEN
                            -- Calculate full years from start to expiry
                            FLOOR(EXTRACT(EPOCH FROM (us.expires_at - us.starts_at)) / 31536000)::INTEGER
                        WHEN us.starts_at IS NOT NULL THEN
                            -- For active subscriptions, calculate full years from start to now
                            -- Use GREATEST to ensure at least 1 year if subscription is active
                            GREATEST(
                                FLOOR(EXTRACT(EPOCH FROM (NOW() - us.starts_at)) / 31536000)::INTEGER,
                                1
                            )
                        ELSE 1
                    END,
                    1  -- Minimum 1 year for any yearly subscription
                ) *
                -- Get per-year price (historical or current)
                COALESCE(
                    (SELECT price_yearly_new 
                     FROM subscription_price_history 
                     WHERE tier_name = us.tier_name 
                     AND changed_at <= us.starts_at
                     ORDER BY changed_at DESC 
                     LIMIT 1),
                    (SELECT price_yearly FROM subscription_tiers WHERE tier_name = us.tier_name),
                    0
                )
            ELSE 0
        END as total_amount_paid
    FROM user_subscriptions us
    WHERE us.user_id = p_user_id
    ORDER BY us.starts_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION get_user_subscription_history IS 'Returns user subscription history for calculating loyalty discounts and tenure.';

-- =====================================================
-- ADD UPDATED_AT TO SUBSCRIPTION_TIERS
-- =====================================================

-- Add updated_at column if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'subscription_tiers' 
        AND column_name = 'updated_at'
    ) THEN
        ALTER TABLE subscription_tiers ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW();
    END IF;
END $$;

-- Add trigger for updated_at
DROP TRIGGER IF EXISTS update_subscription_tiers_updated_at ON subscription_tiers;
CREATE TRIGGER update_subscription_tiers_updated_at
    BEFORE UPDATE ON subscription_tiers
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();


