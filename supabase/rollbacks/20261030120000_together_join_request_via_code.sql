-- Rollback for 20261030120000_together_join_request_via_code.sql (PER-60).
alter table together_join_requests drop column if exists via_code;
