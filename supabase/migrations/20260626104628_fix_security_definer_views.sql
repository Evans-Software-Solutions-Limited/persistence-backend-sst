-- Fix SECURITY DEFINER views — switch to SECURITY INVOKER so they respect
-- the calling user's RLS policies instead of the view creator's.
-- Applied via Supabase MCP 2026-06-26.

ALTER VIEW public.user_subscription_details SET (security_invoker = on);
ALTER VIEW public.user_profile_with_goals SET (security_invoker = on);
ALTER VIEW public.client_professional_team SET (security_invoker = on);
