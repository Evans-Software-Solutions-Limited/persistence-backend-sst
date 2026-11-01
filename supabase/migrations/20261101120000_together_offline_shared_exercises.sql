-- PER-60: exercises a Nearby host shared with a guest, kept with the guest's
-- recovered execution once the host's signed share is verified. Completion
-- copies only these (and only the host's own) into the guest's library.
-- Null for executions uploaded without a share.
alter table together_offline_executions
  add column if not exists shared_exercises jsonb;
