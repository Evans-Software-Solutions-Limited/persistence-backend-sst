-- Rollback for 20261030130000_together_listed_until.sql (PER-60).
alter table together_sessions drop column if exists listed_until;
