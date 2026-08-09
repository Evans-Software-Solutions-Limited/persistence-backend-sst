-- M4 seeded workout-streak achievements but never created the ad-hoc
-- user_streaks row that drives them. The application now creates that row on
-- first evaluation; make concurrent session completion / reconciliation safe.
CREATE UNIQUE INDEX IF NOT EXISTS user_streaks_workout_singleton_uq
  ON public.user_streaks (user_id)
  WHERE streak_type = 'workout_streak' AND source_goal_id IS NULL;
