-- Fuel — one-off / AI-estimated nutrition entries (no foodId/recipeId/mealId)
-- currently render as "Quick entry" because there's nowhere to persist a
-- human label. Add a client-supplied name column: the server stores and
-- returns it verbatim, it does NOT derive or validate it against any food.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS is a no-op on re-run.

ALTER TABLE nutrition_entries ADD COLUMN IF NOT EXISTS custom_name text;
