-- Required profile creation must commit with auth.users or fail the signup.
-- Optional trainer invitation failures remain non-fatal. Never take over a
-- conflicting profile: its owner and data must remain unchanged.
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
END;
$$;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
