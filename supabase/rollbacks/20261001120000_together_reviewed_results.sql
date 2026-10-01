-- Pre-rollout rollback only. After recovery writes exist retain this table and roll back application code.
DROP TABLE IF EXISTS "together_reviewed_results";
