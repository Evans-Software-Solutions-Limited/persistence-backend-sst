-- M7 — Notification preferences storage.
--
-- Adds a JSONB column on `profiles` to hold a per-type notification
-- preference map of shape Record<NotificationType, boolean>. Storage
-- choice (option B in the BRIEF) was Brad's call:
--
--   - Tiny, low-frequency payload (≤ 9 keys today, < 1KB)
--   - Matches the legacy app's pattern of stuffing user prefs on the
--     profile row
--   - One additive migration vs. a new table + RLS policies + indexes
--
-- See specs/09-notifications-social/design.md § Notification preferences.
--
-- Default is `'{}'::jsonb`, which the read handler treats as "all
-- enabled" (synthesises defaults for every NotificationType key on the
-- way out). Writes are full-replace — the handler echoes the map back
-- after validating keys against the current NotificationType union.
--
-- Trigger safety: no existing trigger watches this column.
-- `update_subscription_limits_trigger` (added in
-- 004_subscriptions_and_roles.sql) keys off subscription_id, payment_status,
-- and related subscription columns — not profile prefs. Confirmed safe.
--
-- Idempotent: `ADD COLUMN IF NOT EXISTS` makes re-runs no-ops. The
-- DEFAULT applies retroactively to existing rows on the first run (Postgres
-- 11+ behaviour — no table rewrite needed for a constant default on
-- JSONB).

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS notification_preferences JSONB NOT NULL
    DEFAULT '{}'::JSONB;

COMMENT ON COLUMN profiles.notification_preferences IS
  'M7: Per-type notification preference map (Record<NotificationType, boolean>). Empty object reads back as all-enabled via the API; unknown keys dropped by the read handler.';
