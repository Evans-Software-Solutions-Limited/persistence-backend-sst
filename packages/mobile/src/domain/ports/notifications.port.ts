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
}
