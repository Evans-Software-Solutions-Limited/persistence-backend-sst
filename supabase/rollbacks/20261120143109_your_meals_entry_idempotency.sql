-- Rollback for 20261120143109_your_meals_entry_idempotency.sql (PER-109).
--
-- ⚠ Roll back the core deploy FIRST: the schema declares these columns, so a
-- Lambda carrying it fails every nutrition_entries read once they're gone.
-- Dropping user_meal_id / client_request_id loses which custom meal each entry
-- was logged into and the replay keys; the entries themselves (and their
-- meal_slot) are untouched.
DROP INDEX IF EXISTS nutrition_entries_user_meal_idx;
DROP INDEX IF EXISTS nutrition_entries_user_client_request_idx;
ALTER TABLE nutrition_entries DROP COLUMN IF EXISTS client_request_id;
ALTER TABLE nutrition_entries DROP COLUMN IF EXISTS source_plan_meal_id;
ALTER TABLE nutrition_entries DROP COLUMN IF EXISTS source_plan_id;
ALTER TABLE nutrition_entries DROP COLUMN IF EXISTS user_meal_id;
DROP TABLE IF EXISTS user_meals;
