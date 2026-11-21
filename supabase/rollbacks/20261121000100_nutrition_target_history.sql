-- Rollback for 20261121000100_nutrition_target_history.sql (PER-114).
--
-- ⚠ Roll back the core deploy FIRST: the adherence reads select from this
-- table. nutrition_targets itself is untouched; only the history of earlier
-- targets is lost (calorie adherence then has no target for past days).
DROP TRIGGER IF EXISTS nutrition_targets_record_history ON nutrition_targets;
DROP FUNCTION IF EXISTS record_nutrition_target_history();
DROP INDEX IF EXISTS nutrition_target_history_user_effective_idx;
DROP TABLE IF EXISTS nutrition_target_history;
