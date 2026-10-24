-- Rollback for 20261023120000_together_session_code.sql (PER-60).
drop index if exists together_sessions_code_idx;
alter table together_sessions drop column if exists code;
