-- =====================================================
-- TRAINER INVITATIONS AND PUSH NOTIFICATIONS
-- =====================================================

-- =====================================================
-- TRAINER INVITATIONS TABLE
-- =====================================================

CREATE TABLE trainer_invitations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trainer_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    client_email TEXT NOT NULL,
    relationship_reason TEXT,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'cancelled')),
    
    -- Timestamps
    invited_at TIMESTAMPTZ DEFAULT NOW(),
    accepted_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ
);

-- Ensure one pending invitation per trainer-email pair (partial unique index)
CREATE UNIQUE INDEX idx_trainer_invitations_unique_pending 
ON trainer_invitations(trainer_id, client_email) 
WHERE status = 'pending';

CREATE INDEX idx_trainer_invitations_trainer ON trainer_invitations(trainer_id);
CREATE INDEX idx_trainer_invitations_email ON trainer_invitations(client_email);
CREATE INDEX idx_trainer_invitations_status ON trainer_invitations(status);

COMMENT ON TABLE trainer_invitations IS 'Stores pending trainer invitations for clients who have not yet signed up. When client signs up with matching email, relationship is automatically created.';
COMMENT ON COLUMN trainer_invitations.status IS 'pending: waiting for client to sign up, accepted: client signed up and relationship created, cancelled: trainer cancelled invitation';

-- =====================================================
-- USER DEVICES TABLE (FOR PUSH NOTIFICATIONS)
-- =====================================================

CREATE TABLE user_devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    device_token TEXT NOT NULL,
    platform TEXT NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
    device_info JSONB DEFAULT '{}',
    is_active BOOLEAN DEFAULT true,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    last_used_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- One active device token per user-device combination
    UNIQUE(user_id, device_token)
);

CREATE INDEX idx_user_devices_user ON user_devices(user_id);
CREATE INDEX idx_user_devices_active ON user_devices(user_id, is_active) WHERE is_active = true;
CREATE INDEX idx_user_devices_token ON user_devices(device_token);

COMMENT ON TABLE user_devices IS 'Stores device tokens for push notifications. Multiple devices per user supported.';
COMMENT ON COLUMN user_devices.device_info IS 'JSONB object with device metadata (model, OS version, app version, etc.)';

-- =====================================================
-- SUBSCRIPTION PRICE HISTORY TABLE (AUDIT TRAIL)
-- =====================================================

CREATE TABLE subscription_price_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tier_name TEXT NOT NULL REFERENCES subscription_tiers(tier_name) ON DELETE CASCADE,
    price_monthly_old DECIMAL(10,2),
    price_monthly_new DECIMAL(10,2),
    price_yearly_old DECIMAL(10,2),
    price_yearly_new DECIMAL(10,2),
    currency TEXT DEFAULT 'GBP',
    changed_by UUID REFERENCES profiles(id),
    change_reason TEXT,
    
    changed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_price_history_tier ON subscription_price_history(tier_name);
CREATE INDEX idx_price_history_changed_by ON subscription_price_history(changed_by);
CREATE INDEX idx_price_history_changed_at ON subscription_price_history(changed_at);

COMMENT ON TABLE subscription_price_history IS 'Audit trail for all subscription price changes. Used for historical pricing and future discount calculations.';

-- =====================================================
-- HELPER FUNCTION: GET PROFILE BY EMAIL (BYPASSES RLS)
-- =====================================================

CREATE OR REPLACE FUNCTION get_profile_by_email_internal(p_email TEXT)
RETURNS SETOF profiles AS $$
DECLARE
    v_auth_user_id UUID;
BEGIN
    -- Find user in auth.users (no RLS on auth schema)
    SELECT au.id INTO v_auth_user_id
    FROM auth.users au
    WHERE lower(au.email) = lower(p_email);
    
    -- If found, return full profile record directly (SECURITY DEFINER bypasses RLS)
    IF v_auth_user_id IS NOT NULL THEN
        RETURN QUERY
        SELECT p.*
        FROM profiles p
        WHERE p.id = v_auth_user_id;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION get_profile_by_email_internal IS 'Internal helper function to lookup profiles by email, bypassing RLS by using auth.users lookup first.';

-- =====================================================
-- FUNCTION: INVITE CLIENT BY EMAIL
-- =====================================================

CREATE OR REPLACE FUNCTION invite_client_by_email(
    p_trainer_id UUID,
    p_client_email TEXT,
    p_relationship_reason TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
    v_client_profile RECORD;
    v_invitation_id UUID;
    v_relationship_id UUID;
    v_result JSONB;
    v_current_user_id UUID;
    v_auth_user_id UUID;
BEGIN
    -- Set search path to ensure we're using the right schema
    SET LOCAL search_path = public;
    -- Get current authenticated user
    v_current_user_id := auth.uid();
    
    IF v_current_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;
    
    -- Verify that the caller is the trainer they claim to be
    IF v_current_user_id != p_trainer_id THEN
        RAISE EXCEPTION 'Unauthorized: Cannot create invitations for other trainers';
    END IF;
    
    -- Normalize email (lowercase)
    p_client_email := lower(trim(p_client_email));
    
    -- Validate email format (basic check)
    IF p_client_email !~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' THEN
        RAISE EXCEPTION 'Invalid email format';
    END IF;
    
    -- Check if trainer exists and is a trainer
    -- Use SECURITY DEFINER privileges to bypass RLS
    IF NOT EXISTS (
        SELECT 1 FROM profiles 
        WHERE id = p_trainer_id 
            AND role IN ('personal_trainer', 'physiotherapist')
    ) THEN
        RAISE EXCEPTION 'User is not a trainer';
    END IF;
    
    -- Check if client email matches trainer's email (prevent self-invitation)
    IF EXISTS (
        SELECT 1 FROM profiles 
        WHERE id = p_trainer_id 
        AND lower(email) = p_client_email
    ) THEN
        RAISE EXCEPTION 'Cannot invite yourself';
    END IF;
    
    -- Check if user with this email already exists
    -- IMPORTANT: SECURITY DEFINER functions should bypass RLS, but Supabase applies RLS based on auth.uid()
    -- Solution: Use helper function that queries auth.users first (no RLS), then gets profile by ID
    -- The helper function is SECURITY DEFINER and returns full profile record directly
    BEGIN
        SELECT * INTO v_client_profile
        FROM get_profile_by_email_internal(p_client_email)
        LIMIT 1;
    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            -- No user found, v_client_profile remains NULL
            v_client_profile := NULL;
        WHEN OTHERS THEN
            -- Any other error, treat as no user found
            v_client_profile := NULL;
    END;
    
    -- Check if we found a profile (check id field since RECORD might not be NULL even if empty)
    IF v_client_profile.id IS NOT NULL THEN
        -- User exists - create relationship directly
        -- Check if relationship already exists
        IF EXISTS (
            SELECT 1 FROM pt_client_relationships
            WHERE trainer_id = p_trainer_id
            AND client_id = v_client_profile.id
        ) THEN
            RAISE EXCEPTION 'Relationship already exists with this client';
        END IF;
        
        -- Check trainer slots
        IF NOT (check_trainer_slots(p_trainer_id)->>'has_slots')::boolean THEN
            RAISE EXCEPTION 'Trainer has no available client slots';
        END IF;
        
        -- Create relationship
        INSERT INTO pt_client_relationships (
            trainer_id,
            client_id,
            status,
            relationship_reason
        ) VALUES (
            p_trainer_id,
            v_client_profile.id,
            'pending',
            p_relationship_reason
        ) RETURNING id INTO v_relationship_id;
        
        -- Return success with relationship info
        RETURN jsonb_build_object(
            'success', true,
            'action', 'relationship_created',
            'relationship_id', v_relationship_id,
            'client_id', v_client_profile.id,
            'client_name', v_client_profile.full_name,
            'message', 'Training request sent to ' || v_client_profile.full_name
        );
    ELSE
        -- User doesn't exist - create invitation
        -- Check trainer slots before creating invitation (consistent with existing user path)
        IF NOT (check_trainer_slots(p_trainer_id)->>'has_slots')::boolean THEN
            RAISE EXCEPTION 'Trainer has no available client slots';
        END IF;
        
        -- Check if pending invitation already exists
        IF EXISTS (
            SELECT 1 FROM trainer_invitations
            WHERE trainer_id = p_trainer_id
            AND lower(client_email) = p_client_email
            AND status = 'pending'
        ) THEN
            RAISE EXCEPTION 'Invitation already sent to this email';
        END IF;
        
        -- Create invitation
        INSERT INTO trainer_invitations (
            trainer_id,
            client_email,
            relationship_reason,
            status
        ) VALUES (
            p_trainer_id,
            p_client_email,
            p_relationship_reason,
            'pending'
        ) RETURNING id INTO v_invitation_id;
        
        -- Return success with invitation info
        RETURN jsonb_build_object(
            'success', true,
            'action', 'invitation_created',
            'invitation_id', v_invitation_id,
            'client_email', p_client_email,
            'message', 'Invitation will be sent when ' || p_client_email || ' signs up'
        );
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION invite_client_by_email IS 'Invites a client by email. If user exists, creates relationship directly. If not, creates pending invitation that will be processed when user signs up.';

-- =====================================================
-- FUNCTION: CANCEL TRAINER INVITATION
-- =====================================================

CREATE OR REPLACE FUNCTION cancel_trainer_invitation(
    p_trainer_id UUID,
    p_invitation_id UUID
)
RETURNS JSONB AS $$
DECLARE
    v_invitation RECORD;
    v_current_user_id UUID;
BEGIN
    -- Get current authenticated user
    v_current_user_id := auth.uid();
    
    IF v_current_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;
    
    -- Verify that the caller is the trainer they claim to be
    IF v_current_user_id != p_trainer_id THEN
        RAISE EXCEPTION 'Unauthorized: Cannot cancel invitations for other trainers';
    END IF;
    
    -- Get invitation
    SELECT * INTO v_invitation
    FROM trainer_invitations
    WHERE id = p_invitation_id
    AND trainer_id = p_trainer_id;
    
    IF v_invitation IS NULL THEN
        RAISE EXCEPTION 'Invitation not found or access denied';
    END IF;
    
    IF v_invitation.status != 'pending' THEN
        RAISE EXCEPTION 'Can only cancel pending invitations';
    END IF;
    
    -- Update invitation status
    -- Include status = 'pending' in WHERE clause to prevent race condition:
    -- If process_pending_invitations runs concurrently and changes status to 'accepted',
    -- this UPDATE will affect 0 rows, preventing inconsistent state
    UPDATE trainer_invitations
    SET status = 'cancelled',
        cancelled_at = NOW()
    WHERE id = p_invitation_id
    AND status = 'pending';
    
    -- Check if update actually affected a row
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invitation is no longer pending (may have been accepted)';
    END IF;
    
    RETURN jsonb_build_object(
        'success', true,
        'message', 'Invitation cancelled'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION cancel_trainer_invitation IS 'Cancels a pending trainer invitation. Only the trainer who created it can cancel it.';

-- =====================================================
-- FUNCTION: PROCESS PENDING INVITATIONS ON SIGNUP
-- =====================================================

CREATE OR REPLACE FUNCTION process_pending_invitations(p_user_id UUID, p_user_email TEXT)
RETURNS VOID AS $$
DECLARE
    v_invitation RECORD;
    v_trainer_profile RECORD;
    v_relationship_id UUID;
    v_current_user_id UUID;
    v_profile_email TEXT;
BEGIN
    -- Security check: Prevent RPC abuse
    -- If called via RPC (auth.uid() is set), verify caller owns the user_id
    -- If called from trigger (auth.uid() is NULL), verify user_id and email match a profile
    v_current_user_id := auth.uid();
    
    IF v_current_user_id IS NOT NULL THEN
        -- Called via RPC - verify caller owns the user_id
        IF v_current_user_id != p_user_id THEN
            RAISE EXCEPTION 'Unauthorized: Cannot process invitations for other users';
        END IF;
        
        -- Verify email matches the caller's profile
        SELECT email INTO v_profile_email
        FROM profiles
        WHERE id = p_user_id;
        
        IF v_profile_email IS NULL OR lower(v_profile_email) != lower(p_user_email) THEN
            RAISE EXCEPTION 'Email does not match user profile';
        END IF;
    ELSE
        -- Called from trigger - verify user_id and email match an existing profile
        SELECT email INTO v_profile_email
        FROM profiles
        WHERE id = p_user_id
        AND lower(email) = lower(p_user_email);
        
        IF v_profile_email IS NULL THEN
            RAISE EXCEPTION 'User profile not found or email mismatch';
        END IF;
    END IF;
    
    -- Find all pending invitations for this email
    FOR v_invitation IN
        SELECT * FROM trainer_invitations
        WHERE lower(client_email) = lower(p_user_email)
        AND status = 'pending'
    LOOP
        -- Get trainer profile
        SELECT * INTO v_trainer_profile
        FROM profiles
        WHERE id = v_invitation.trainer_id;
        
        -- Check if trainer still exists and has slots
        IF v_trainer_profile IS NOT NULL THEN
            -- Check trainer slots (only for non-AI trainers)
            IF (check_trainer_slots(v_invitation.trainer_id)->>'has_slots')::boolean THEN
                -- Create relationship
                INSERT INTO pt_client_relationships (
                    trainer_id,
                    client_id,
                    status,
                    relationship_reason
                ) VALUES (
                    v_invitation.trainer_id,
                    p_user_id,
                    'pending',
                    v_invitation.relationship_reason
                ) RETURNING id INTO v_relationship_id;
                
                -- Update invitation status
                UPDATE trainer_invitations
                SET status = 'accepted',
                    accepted_at = NOW()
                WHERE id = v_invitation.id;
            ELSE
                -- Trainer has no slots - mark invitation as cancelled
                UPDATE trainer_invitations
                SET status = 'cancelled',
                    cancelled_at = NOW()
                WHERE id = v_invitation.id;
            END IF;
        ELSE
            -- Trainer no longer exists - cancel invitation
            UPDATE trainer_invitations
            SET status = 'cancelled',
                cancelled_at = NOW()
            WHERE id = v_invitation.id;
        END IF;
    END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION process_pending_invitations IS 'Processes pending trainer invitations when a user signs up. Called automatically by handle_new_user trigger.';

-- =====================================================
-- MODIFY PROFILE CREATION TRIGGER
-- =====================================================

-- Update handle_new_user to process invitations
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

  -- Process pending trainer invitations for this email
  -- Wrap in exception handler to prevent invitation processing failures from rolling back profile creation
  BEGIN
    PERFORM process_pending_invitations(NEW.id, NEW.email);
  EXCEPTION
    WHEN OTHERS THEN
      -- Log the error but don't fail profile creation
      -- Invitation processing is non-critical - user can still use the app
      RAISE WARNING 'Error processing pending invitations for user %: % (SQLSTATE: %)', NEW.id, SQLERRM, SQLSTATE;
  END;

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'Error creating profile for user %: % (SQLSTATE: %)', NEW.id, SQLERRM, SQLSTATE;
    RETURN NEW;
END;
$$;

-- =====================================================
-- FUNCTION: REGISTER DEVICE FOR PUSH NOTIFICATIONS
-- =====================================================

CREATE OR REPLACE FUNCTION register_device_token(
    p_user_id UUID,
    p_device_token TEXT,
    p_platform TEXT,
    p_device_info JSONB DEFAULT '{}'::JSONB
)
RETURNS JSONB AS $$
DECLARE
    v_device_id UUID;
    v_current_user_id UUID;
BEGIN
    -- Get current authenticated user
    v_current_user_id := auth.uid();
    
    IF v_current_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;
    
    -- Verify that the caller is registering their own device token
    IF v_current_user_id != p_user_id THEN
        RAISE EXCEPTION 'Unauthorized: Cannot register device tokens for other users';
    END IF;
    
    -- Validate platform
    IF p_platform NOT IN ('ios', 'android', 'web') THEN
        RAISE EXCEPTION 'Invalid platform. Must be ios, android, or web';
    END IF;
    
    -- Insert or update device token
    INSERT INTO user_devices (
        user_id,
        device_token,
        platform,
        device_info,
        is_active,
        last_used_at
    ) VALUES (
        p_user_id,
        p_device_token,
        p_platform,
        p_device_info,
        true,
        NOW()
    )
    ON CONFLICT (user_id, device_token)
    DO UPDATE SET
        platform = EXCLUDED.platform,
        device_info = EXCLUDED.device_info,
        is_active = true,
        last_used_at = NOW(),
        updated_at = NOW()
    RETURNING id INTO v_device_id;
    
    RETURN jsonb_build_object(
        'success', true,
        'device_id', v_device_id,
        'message', 'Device registered successfully'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION register_device_token IS 'Registers or updates a device token for push notifications. Multiple devices per user supported.';

-- =====================================================
-- FUNCTION: UNREGISTER DEVICE TOKEN
-- =====================================================

CREATE OR REPLACE FUNCTION unregister_device_token(
    p_user_id UUID,
    p_device_token TEXT
)
RETURNS JSONB AS $$
DECLARE
    v_current_user_id UUID;
BEGIN
    -- Get current authenticated user
    v_current_user_id := auth.uid();
    
    IF v_current_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;
    
    -- Verify that the caller is unregistering their own device token
    IF v_current_user_id != p_user_id THEN
        RAISE EXCEPTION 'Unauthorized: Cannot unregister device tokens for other users';
    END IF;
    
    UPDATE user_devices
    SET is_active = false,
        updated_at = NOW()
    WHERE user_id = p_user_id
    AND device_token = p_device_token;
    
    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', false,
            'message', 'Device token not found'
        );
    END IF;
    
    RETURN jsonb_build_object(
        'success', true,
        'message', 'Device unregistered successfully'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION unregister_device_token IS 'Unregisters a device token (marks as inactive). Called when user logs out or uninstalls app.';

