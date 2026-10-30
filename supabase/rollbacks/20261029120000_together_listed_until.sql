-- Rollback for 20261029120000_together_listed_until.sql (PER-60).
alter table together_sessions drop column if exists listed_until;
