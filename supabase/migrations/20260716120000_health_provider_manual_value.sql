-- specs/20-sleep-quicklog — add 'manual' to the health_provider enum so a
-- manual sleep quick-log can write sleep_data.data_source = 'manual'
-- (STORY-002 AC 2.4). Once concrete (not NULL), the existing unique index
-- `sleep_data_user_date_source_idx` on (user_id, sleep_date, data_source)
-- enforces exactly one manual row per user per day.
--
-- Standalone migration, no usage in the same transaction: Postgres forbids
-- using a newly added enum value in the same transaction block that adds it
-- (mirrors the M8/M17 precedent, e.g.
-- 20260705150000_coach_notification_type_on_behalf_values.sql).
--
-- Idempotent: ADD VALUE IF NOT EXISTS is a no-op on re-run. Append-only —
-- forward/back safe (a rollback leaves one unused enum value, harmless).

ALTER TYPE health_provider ADD VALUE IF NOT EXISTS 'manual';
