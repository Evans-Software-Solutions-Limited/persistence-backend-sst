-- Server-only capability lookup. No account ID or discovery preference is encoded in a code.
CREATE TABLE IF NOT EXISTS public.social_person_codes (
 user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
 code_hash text NOT NULL UNIQUE,
 expires_at timestamptz NOT NULL
);
ALTER TABLE public.social_person_codes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.social_person_codes FROM PUBLIC, anon, authenticated;
