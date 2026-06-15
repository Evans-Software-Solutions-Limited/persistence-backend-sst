-- M4 (06-progress-goals) — seed the achievements lookup for streak milestones.
--
-- Data migration (not schema) per design.md § Drizzle migrations item 3. For
-- every (streak type × tier) in cross-cuts § 3.6 we insert one row into the
-- existing `achievements` lookup with category='streak' and a
-- requirements JSONB of { streak_type, threshold }. The streak engine (06.2)
-- resolves achievement_id by JSONB equality on (category, requirements) when
-- writing user_achievements rows.
--
-- Milestone thresholds (cross-cuts § 3.6, locked 2026-05-25):
--   Weekly (workout_streak, measurement_streak): 1, 2, 4, 8, 12
--   Daily  (habit_streak, nutrition_streak):     7, 14, 28, 60, 90
-- nutrition_streak is M9-gated; seeding its rows now is harmless (no
-- nutrition streaks are created until M9 lights up the event source).
--
-- Idempotent: each row is inserted only when no streak achievement with the
-- same requirements JSONB already exists. jsonb equality is order-insensitive
-- (jsonb is stored normalised), so re-runs and key-order variance are no-ops.
-- The seed is kept separate from the schema block so a rollback can DELETE
-- WHERE category='streak' without touching the M4 tables.
--
-- Icon/tone is intentionally NOT stored here — the presenter derives it from
-- (streak_type, threshold) per design.md § Achievement triggers
-- (ACHIEVEMENT_ICONS). The data layer stores type + threshold only.

INSERT INTO achievements (name, description, category, requirements)
SELECT v.name, v.description, 'streak'::achievement_category, v.requirements::jsonb
FROM (VALUES
  -- workout_streak (weekly)
  ('Workout Streak — 1 week',    'Logged a workout every week for 1 week.',    '{"streak_type":"workout_streak","threshold":1}'),
  ('Workout Streak — 2 weeks',   'Logged a workout every week for 2 weeks.',   '{"streak_type":"workout_streak","threshold":2}'),
  ('Workout Streak — 4 weeks',   'Logged a workout every week for 4 weeks.',   '{"streak_type":"workout_streak","threshold":4}'),
  ('Workout Streak — 8 weeks',   'Logged a workout every week for 8 weeks.',   '{"streak_type":"workout_streak","threshold":8}'),
  ('Workout Streak — 12 weeks',  'Logged a workout every week for 12 weeks.',  '{"streak_type":"workout_streak","threshold":12}'),
  -- measurement_streak (weekly)
  ('Check-in Streak — 1 week',   'Logged a measurement every week for 1 week.',   '{"streak_type":"measurement_streak","threshold":1}'),
  ('Check-in Streak — 2 weeks',  'Logged a measurement every week for 2 weeks.',  '{"streak_type":"measurement_streak","threshold":2}'),
  ('Check-in Streak — 4 weeks',  'Logged a measurement every week for 4 weeks.',  '{"streak_type":"measurement_streak","threshold":4}'),
  ('Check-in Streak — 8 weeks',  'Logged a measurement every week for 8 weeks.',  '{"streak_type":"measurement_streak","threshold":8}'),
  ('Check-in Streak — 12 weeks', 'Logged a measurement every week for 12 weeks.', '{"streak_type":"measurement_streak","threshold":12}'),
  -- habit_streak (daily)
  ('Habit Streak — 7 days',      'Completed your habit 7 days in a row.',      '{"streak_type":"habit_streak","threshold":7}'),
  ('Habit Streak — 14 days',     'Completed your habit 14 days in a row.',     '{"streak_type":"habit_streak","threshold":14}'),
  ('Habit Streak — 28 days',     'Completed your habit 28 days in a row.',     '{"streak_type":"habit_streak","threshold":28}'),
  ('Habit Streak — 60 days',     'Completed your habit 60 days in a row.',     '{"streak_type":"habit_streak","threshold":60}'),
  ('Habit Streak — 90 days',     'Completed your habit 90 days in a row.',     '{"streak_type":"habit_streak","threshold":90}'),
  -- nutrition_streak (daily, M9-gated)
  ('Nutrition Streak — 7 days',  'Hit your nutrition target 7 days in a row.',  '{"streak_type":"nutrition_streak","threshold":7}'),
  ('Nutrition Streak — 14 days', 'Hit your nutrition target 14 days in a row.', '{"streak_type":"nutrition_streak","threshold":14}'),
  ('Nutrition Streak — 28 days', 'Hit your nutrition target 28 days in a row.', '{"streak_type":"nutrition_streak","threshold":28}'),
  ('Nutrition Streak — 60 days', 'Hit your nutrition target 60 days in a row.', '{"streak_type":"nutrition_streak","threshold":60}'),
  ('Nutrition Streak — 90 days', 'Hit your nutrition target 90 days in a row.', '{"streak_type":"nutrition_streak","threshold":90}')
) AS v(name, description, requirements)
WHERE NOT EXISTS (
  SELECT 1 FROM achievements a
  WHERE a.category = 'streak'
    AND a.requirements = v.requirements::jsonb
);
