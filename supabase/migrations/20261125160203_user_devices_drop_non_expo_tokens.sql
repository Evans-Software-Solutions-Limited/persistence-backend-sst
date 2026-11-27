-- PER-149: remove user_devices rows that hold a raw native push token.
--
-- The app's token listener also registered the raw APNs (iOS) / FCM (Android)
-- device token next to the Expo push token. The backend only sends through
-- the Expo Push API, which can't deliver to a raw token, so those rows are
-- junk. Production on 25 Nov 2026: 64 iOS rows holding a 64-hex-char APNs
-- token (53 active), next to 56 Expo-token rows. Stream chat registers the
-- native token with Stream directly from the app, so user_devices only ever
-- needs Expo tokens.
--
-- From this release the app registers only Expo tokens, and core's
-- POST /devices/register answers 200 without storing a non-Expo token (1.2.0
-- phones keep sending them until they update).
--
-- What counts as an Expo token is exactly expo-server-sdk's
-- `Expo.isExpoPushToken`, mirrored by core's `isExpoPushToken`
-- (microservices/core/src/application/notifications/push/expoPushClient.ts):
--   * starts with `ExponentPushToken[` or `ExpoPushToken[` and ends with `]`
--     (case-sensitive; LIKE treats `[` and `]` literally), or
--   * the legacy bare-UUID form.
-- Every row matching either form is kept. Only rows matching neither are
-- deleted. Tokens are trimmed on insert by core, so no whitespace variants.
--
-- No table references user_devices, so the delete cascades nowhere.
--
-- Idempotent: once run, no row matches, so re-running deletes nothing.
-- Rollback: supabase/rollbacks/20261125160203_user_devices_drop_non_expo_tokens.sql
-- (a documented no-op: deleted junk tokens can't be restored).

DELETE FROM user_devices
WHERE device_token NOT LIKE 'ExponentPushToken[%]'
  AND device_token NOT LIKE 'ExpoPushToken[%]'
  AND device_token !~* '^[a-z0-9]{8}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{12}$';
