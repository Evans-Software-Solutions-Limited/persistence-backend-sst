-- Keep bundled workout templates visible by default, while allowing each
-- user to hide them from their own workout library.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS show_template_workouts BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN public.profiles.show_template_workouts IS
  'Whether bundled template workouts are shown in this user''s workout library.';
