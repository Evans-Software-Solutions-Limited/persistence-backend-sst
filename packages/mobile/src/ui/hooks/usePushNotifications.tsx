/**
 * Push-notification registration + foreground refresh (09.2).
 *
 * Mounted once from `app/_layout.tsx` (PushNotificationsBootstrap),
 * inside AppProviders and below AuthGate's data so `useAuth` resolves.
 * Reuses the PR #64 expo-notifications wiring (the notification handler +
 * Android channel set up in `app/_layout.tsx`, the permission flow in
 * `useNotificationPermissions`) — this hook adds ONLY the push-token
 * side + the foreground-receive refresh.
 *
 * Responsibilities (STORY-004):
 *  - After auth resolves, ensure permission, read the device push token,
 *    and POST it to `/devices/register`. (AC 4.1, 4.2)
 *  - First-launch permission request; if denied, register nothing —
 *    re-enable later from the Preferences screen. (AC 4.3)
 *  - Re-register on auth change (new userId) and on Expo token rotation.
 *    (AC 4.4)
 *  - Failed registration is logged, never blocks app launch. (AC 4.5)
 *  - A notification received while foregrounded refreshes the cached list
 *    + unread count so the bell badge / list stay live without a restart.
 *    (STORY-001 AC 1.5)
 *
 * The tap/deep-link RESPONSE listener (cold-start + background) is wired
 * separately in 09.6 — this hook deliberately owns only registration +
 * the foreground-receive refresh.
 *
 * Spec: specs/09-notifications-social/design.md § Push notification listener
 *       requirements.md STORY-004
 */

import { useCallback, useEffect, useRef } from "react";
import { Platform } from "react-native";
import {
  refreshNotifications,
  refreshUnreadCount,
} from "@/application/notifications";
import { useAdapters } from "./useAdapters";
import { useAuth } from "./useAuth";

function devicePlatform(): "ios" | "android" {
  return Platform.OS === "android" ? "android" : "ios";
}

/**
 * @param enabled defaults to true; pass false to disable (tests / a
 * future Settings opt-out).
 */
export function usePushNotifications(enabled = true): void {
  const { api, notifications, storage } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;

  // Register at most once per signed-in user per launch. Re-arms when the
  // userId changes (sign-out → sign-in as a different account), satisfying
  // AC 4.4's "re-register on auth change".
  const registeredForRef = useRef<string | null>(null);

  const register = useCallback(async (): Promise<void> => {
    // Ensure permission. `useNotificationPermissions` already prompts on
    // launch; we re-check here and only prompt when still undetermined so
    // a denied user is never re-nagged (AC 4.3).
    const status = await notifications.getPermissionStatus();
    let granted = status === "granted";
    if (status === "not_determined") {
      const requested = await notifications.requestPermissions();
      granted = requested.ok && requested.value === "granted";
    }
    if (!granted) return; // denied → register nothing (AC 4.3)

    const tokenResult = await notifications.getDevicePushToken();
    if (!tokenResult.ok) return;

    // `registerDevice` returns a Result — it does NOT throw on a
    // transport/server failure. Inspect `ok` explicitly: on failure roll
    // back the per-user "already registered" guard so a later re-render /
    // token rotation gets another shot, and throw so the outer `.catch`
    // logs uniformly with the JS-error path (AC 4.5). Without this a failed
    // registration is silent and never retried for the session.
    const registerResult = await api.registerDevice({
      token: tokenResult.value,
      platform: devicePlatform(),
    });
    if (!registerResult.ok) {
      registeredForRef.current = null;
      throw new Error(
        `device registration rejected: ${registerResult.error.message}`,
      );
    }
  }, [api, notifications]);

  // Registration on auth resolve / change.
  useEffect(() => {
    if (!enabled || !userId) return;
    if (registeredForRef.current === userId) return;
    registeredForRef.current = userId;
    register().catch((err) => {
      // AC 4.5: failure is non-fatal — log and move on.
      console.warn("[push] device registration failed:", err);
    });
  }, [enabled, userId, register]);

  // Re-register on Expo token rotation (AC 4.4).
  useEffect(() => {
    if (!enabled || !userId) return;
    const unsubscribe = notifications.addPushTokenListener(() => {
      register().catch((err) => {
        console.warn("[push] re-registration on token rotation failed:", err);
      });
    });
    return unsubscribe;
  }, [enabled, userId, notifications, register]);

  // Foreground receive → refresh cache + unread count (STORY-001 AC 1.5).
  useEffect(() => {
    if (!enabled || !userId) return;
    const unsubscribe = notifications.addNotificationReceivedListener(() => {
      void refreshNotifications(api, storage);
      void refreshUnreadCount(api, storage);
    });
    return unsubscribe;
  }, [enabled, userId, notifications, api, storage]);
}
