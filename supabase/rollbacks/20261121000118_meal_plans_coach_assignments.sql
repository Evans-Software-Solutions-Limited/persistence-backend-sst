-- Rollback for 20261121000118_meal_plans_coach_assignments.sql (PER-118).
--
-- ⚠ Roll back the core deploy FIRST: the schema declares the recipe attribution
-- columns, so a Lambda carrying it fails every recipe read once they're gone.
-- Dropping the plan tables loses every list meal plan, coach assignment and
-- shopping-list selection. Logged food is untouched (entries only keep
-- `source_plan_id`, which has no FK). Shared recipe copies stay with their new
-- owners; only the attribution is lost.
--
-- The enum values added by the forward migration are left in place: Postgres
-- can't drop an enum value, and an unused value is harmless.
DROP INDEX IF EXISTS recipes_user_source_recipe_idx;
ALTER TABLE recipes DROP COLUMN IF EXISTS shared_by_user_id;
ALTER TABLE recipes DROP COLUMN IF EXISTS source_recipe_id;
DROP TABLE IF EXISTS shopping_list_plans;
DROP TABLE IF EXISTS nutrition_plan_assignments;
DROP TABLE IF EXISTS nutrition_plan_items;
DROP TABLE IF EXISTS nutrition_plan_meals;
DROP TABLE IF EXISTS nutrition_plans;
