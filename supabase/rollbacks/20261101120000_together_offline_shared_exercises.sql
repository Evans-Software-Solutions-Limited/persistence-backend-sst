-- Rollback for 20261101120000_together_offline_shared_exercises.sql (PER-60).
alter table together_offline_executions drop column if exists shared_exercises;
