-- Security hardening: revoke EXECUTE from anon (and authenticated where
-- appropriate) on SECURITY DEFINER functions that should not be callable
-- via PostgREST /rest/v1/rpc/.
-- Applied via Supabase MCP 2026-06-26.

-- Dangerous: must not be callable by anyone via PostgREST
REVOKE EXECUTE ON FUNCTION public.delete_auth_user(uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.create_test_user_direct(text, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reset_monthly_limits() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cleanup_old_health_data() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_subscription_pricing(text, numeric, numeric, text, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_subscription_limits(uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.setup_subscription(uuid, text, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_exercise_to_algolia() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trigger_push_notification() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated;

-- Sensitive: remove anon, keep authenticated (has internal guards)
REVOKE EXECUTE ON FUNCTION public.cancel_ai_trainer_subscription(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_ai_trainer_subscription(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.invite_client_by_email(uuid, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.cancel_trainer_invitation(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.process_pending_invitations(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.register_device_token(uuid, text, text, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.unregister_device_token(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.check_and_update_pr(uuid, uuid, uuid, numeric, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.can_user_create_workout(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.can_user_generate_ai_workout(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.check_ai_generation_limit(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.check_professional_slots(uuid, public.user_role) FROM anon;
REVOKE EXECUTE ON FUNCTION public.check_trainer_slots(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_ai_gym_buddy_user_context(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_detailed_workout_allowance(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_pricing_history(text, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_profile_by_email_internal(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_role_setup_status(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_shared_client_context(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_trainer_client_summary_data(uuid, uuid, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_user_active_goals(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_user_health_summary(uuid, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_user_professional_roles(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_user_stats(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_user_subscription(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_user_subscription_history(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.gym_buddy_can_create_workouts(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.gym_buddy_can_suggest_workouts(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.has_active_professional_role(uuid, public.user_role) FROM anon;
REVOKE EXECUTE ON FUNCTION public.increment_usage_limit(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.decrement_usage_limit(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.professionals_share_client(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.set_primary_goal(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.try_consume_workout_allowance(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.user_can_access_feature(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.user_has_ai_access(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.user_has_gym_buddy_access(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_user_subscription_details(uuid) FROM anon;
