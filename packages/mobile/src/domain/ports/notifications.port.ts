import type { Result } from "@/shared/errors";

export type NotificationError = {
  readonly kind: "notification";
  readonly code: "permission_denied" | "token_failed" | "schedule_failed";
  readonly message: string;
};

export type LocalNotification = {
  title: string;
  body: string;
  data?: Record<string, string>;
  triggerSeconds?: number;
};

/**
 * Port for push and local notifications.
 * Stub — expanded in milestone 09.
 */
export interface NotificationsPort {
  requestPermissions(): Promise<
    Result<"granted" | "denied", NotificationError>
  >;
  getPermissionStatus(): Promise<"granted" | "denied" | "not_determined">;
  getDevicePushToken(): Promise<Result<string, NotificationError>>;
  scheduleLocalNotification(notification: LocalNotification): Promise<string>;
  cancelLocalNotification(id: string): Promise<void>;

  /**
   * Set the OS app-icon (springboard) badge to the given count. `0` clears
   * it. Drives the "unread count on the app icon, even when the app is
   * closed" behaviour (STORY-001 — Revised 2026-06-08).
   */
  setBadgeCount(count: number): Promise<void>;

  /**
   * Subscribe to device push-token rotation (Expo emits a new token when
   * the OS rotates it). The listener receives the new token string. Used
   * by `usePushNotifications` (09.2) to re-register with the backend.
   * Returns an unsubscribe function.
   */
  addPushTokenListener(listener: (token: string) => void): () => void;

  /**
   * Subscribe to notifications received while the app is foregrounded.
   * The listener takes no args — consumers refresh the cache + unread
   * count off it. Returns an unsubscribe function.
   */
  addNotificationReceivedListener(listener: () => void): () => void;

  /**
   * Subscribe to notification taps (background + foreground responses).
   * The listener receives the tapped notification's `id` + `data.deepLink`
   * (deepLink null when absent). Used by `useNotificationDeepLink` (09.6)
   * to route — the `id` lets the hook dedupe against the cold-start path.
   * Returns an unsubscribe function.
   */
  addNotificationResponseListener(
    listener: (response: NotificationResponseInfo) => void,
  ): () => void;

  /**
   * The response that cold-launched the app (tapped from a killed state),
   * or `null` when the app was NOT opened from a notification.
   *
   * Distinguishing these two cases matters: a normal cold launch (`null`)
   * must not navigate, whereas a tap whose payload omitted `data.deepLink`
   * (`{ deepLink: null }`) should still route — to Home per AC 5.5. A bare
   * `string | null` deepLink can't express that difference.
   */
  getLastNotificationResponse(): Promise<NotificationResponseInfo | null>;
}

/**
 * A tapped notification's identity + deep link. `id` is the platform
 * notification identifier — used to dedupe the cold-start read against the
 * response listener (both can surface the SAME launching tap).
 */
export type NotificationResponseInfo = {
  id: string;
  deepLink: string | null;
};
