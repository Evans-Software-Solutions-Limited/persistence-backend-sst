-- Add a nullable `gender` column to profiles to feed the Fuel Targets TDEE
-- calculator (M9). Mifflin-St Jeor BMR differs by a flat 166 kcal between the
-- male (+5) and female (-161) constants — ~257 kcal/day after the activity
-- multiplier — so the calculator genuinely needs this input rather than a
-- silent default.
--
-- Framed as a metabolic input, not a gender-identity statement: the column
-- holds 'male' | 'female' for the two Mifflin-St Jeor coefficients, plus
-- 'other' for users who decline the binary — the calculator maps 'other'
-- (and NULL-but-explicit "prefer not to say") to the midpoint constant (-78)
-- so everyone can compute a target. NULL = never set → the editor prompts.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + a guarded CHECK constraint so a
-- re-run is a no-op.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS gender text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_gender_check'
  ) THEN
    ALTER TABLE profiles
      ADD CONSTRAINT profiles_gender_check
      CHECK (gender IS NULL OR gender IN ('male', 'female', 'other'));
  END IF;
END $$;
