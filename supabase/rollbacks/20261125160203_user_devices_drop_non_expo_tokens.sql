-- Rollback for 20261125160203_user_devices_drop_non_expo_tokens.sql (PER-149).
--
-- Intentionally a no-op. The forward migration only deletes user_devices rows
-- holding raw APNs/FCM tokens, which the Expo Push API can't deliver to. Those
-- rows can't be rebuilt from anything else in the database, and restoring them
-- would bring back nothing useful: every affected device still has, or will
-- re-register, its Expo-token row on next launch. No schema changed, so there
-- is nothing to undo.
SELECT 1;
