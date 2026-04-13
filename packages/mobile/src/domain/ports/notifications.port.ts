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
}
