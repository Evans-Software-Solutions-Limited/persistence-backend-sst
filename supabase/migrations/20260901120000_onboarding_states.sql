-- Spec 31: durable, user-scoped onboarding progress and recommendation intent.
-- Additive and idempotent so it is safe to re-run during staged rollout.
CREATE TABLE IF NOT EXISTS public.onboarding_states (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  version integer NOT NULL DEFAULT 1,
  current_page text NOT NULL DEFAULT 'welcome',
  completed_pages text[] NOT NULL DEFAULT '{}',
  skipped_pages text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'in_progress',
  path text,
  coach_client_band text,
  intent_keys text[] NOT NULL DEFAULT '{}',
  completed_at timestamptz,
  dismissed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT onboarding_states_version_check CHECK (version = 1),
  CONSTRAINT onboarding_states_page_check CHECK (
    current_page IN ('welcome', 'profile', 'role', 'habits', 'nutrition', 'train', 'recommendation')
  ),
  CONSTRAINT onboarding_states_status_check CHECK (
    status IN ('in_progress', 'completed', 'dismissed')
  ),
  CONSTRAINT onboarding_states_path_check CHECK (
    path IS NULL OR path IN ('athlete', 'coach')
  ),
  CONSTRAINT onboarding_states_coach_band_check CHECK (
    coach_client_band IS NULL OR coach_client_band IN ('1_5', '6_15', '16_30')
  ),
  CONSTRAINT onboarding_states_completed_pages_check CHECK (
    completed_pages <@ ARRAY['welcome', 'profile', 'role', 'habits', 'nutrition', 'train', 'recommendation']::text[]
  ),
  CONSTRAINT onboarding_states_skipped_pages_check CHECK (
    skipped_pages <@ ARRAY['welcome', 'profile', 'role', 'habits', 'nutrition', 'train', 'recommendation']::text[]
  ),
  CONSTRAINT onboarding_states_intent_keys_check CHECK (
    intent_keys <@ ARRAY['nutrition_barcode', 'nutrition_photo_estimate', 'nutrition_mealprint', 'training_three_workouts', 'training_unlimited_workouts', 'training_loadout']::text[]
  )
);

-- Backend-only, matching saved_gyms/nutrition_preferences: the SST pooler role
-- bypasses RLS. The mobile app must use the authenticated Elysia routes so JWT
-- ownership and terminal-state semantics cannot be bypassed through PostgREST.
ALTER TABLE public.onboarding_states ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can read own onboarding state" ON public.onboarding_states;
DROP POLICY IF EXISTS "Users can insert own onboarding state" ON public.onboarding_states;
DROP POLICY IF EXISTS "Users can update own onboarding state" ON public.onboarding_states;
REVOKE ALL ON TABLE public.onboarding_states FROM anon, authenticated;

COMMENT ON TABLE public.onboarding_states IS
  'Spec 31 onboarding orchestration state. Backend-only: RLS on, no policies; use authenticated SST routes.';
