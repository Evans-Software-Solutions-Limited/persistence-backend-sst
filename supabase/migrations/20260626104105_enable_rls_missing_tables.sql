-- Enable RLS on tables that were missing it.
-- Applied via Supabase MCP 2026-06-26. Idempotent (IF NOT EXISTS / safe re-run).

ALTER TABLE habit_completions ENABLE ROW LEVEL SECURITY;
ALTER TABLE habit_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE streak_holidays ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_streaks ENABLE ROW LEVEL SECURITY;
ALTER TABLE nutrition_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE nutrition_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE meals ENABLE ROW LEVEL SECURITY;
ALTER TABLE meal_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE water_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE foods ENABLE ROW LEVEL SECURITY;
ALTER TABLE recipes ENABLE ROW LEVEL SECURITY;
ALTER TABLE recipe_ingredients ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_usage_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE stripe_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_status_transitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE volume_by_muscle_per_user ENABLE ROW LEVEL SECURITY;
ALTER TABLE weekly_volume_per_user ENABLE ROW LEVEL SECURITY;

-- User-owned data policies
CREATE POLICY IF NOT EXISTS "Users can manage own habit completions"
  ON habit_completions FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY IF NOT EXISTS "Users can manage own habit configs"
  ON habit_configs FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY IF NOT EXISTS "Users can manage own streak holidays"
  ON streak_holidays FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY IF NOT EXISTS "Users can manage own streaks"
  ON user_streaks FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY IF NOT EXISTS "Users can manage own nutrition entries"
  ON nutrition_entries FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY IF NOT EXISTS "Users can manage own nutrition targets"
  ON nutrition_targets FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY IF NOT EXISTS "Users can manage own meals"
  ON meals FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY IF NOT EXISTS "Users can manage own meal items"
  ON meal_items FOR ALL TO authenticated
  USING (meal_id IN (SELECT id FROM meals WHERE user_id = auth.uid()))
  WITH CHECK (meal_id IN (SELECT id FROM meals WHERE user_id = auth.uid()));

CREATE POLICY IF NOT EXISTS "Users can manage own water log"
  ON water_log FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Shared reference data (read-only)
CREATE POLICY IF NOT EXISTS "Authenticated users can read foods"
  ON foods FOR SELECT TO authenticated USING (true);

CREATE POLICY IF NOT EXISTS "Authenticated users can read recipes"
  ON recipes FOR SELECT TO authenticated USING (true);

CREATE POLICY IF NOT EXISTS "Authenticated users can read recipe ingredients"
  ON recipe_ingredients FOR SELECT TO authenticated USING (true);

-- Aggregation tables (read-only for owner)
CREATE POLICY IF NOT EXISTS "Users can read own volume data"
  ON volume_by_muscle_per_user FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY IF NOT EXISTS "Users can read own weekly volume"
  ON weekly_volume_per_user FOR SELECT TO authenticated
  USING (user_id = auth.uid());
