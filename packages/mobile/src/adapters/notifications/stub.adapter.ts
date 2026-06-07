import type {
  NotificationsPort,
  NotificationError,
} from "@/domain/ports/notifications.port";
import { fail, type Result } from "@/shared/errors";

const UNAVAILABLE: NotificationError = {
  kind: "notification",
  code: "permission_denied",
  message: "Notifications not yet available",
};

/**
 * No-op notifications adapter. Replaced in milestone 09.
 */
export class StubNotificationsAdapter implements NotificationsPort {
  async requestPermissions(): Promise<
    Result<"granted" | "denied", NotificationError>
  > {
    return fail(UNAVAILABLE);
  }
  async getPermissionStatus(): Promise<
    "granted" | "denied" | "not_determined"
  > {
    return "not_determined";
  }
  async getDevicePushToken(): Promise<Result<string, NotificationError>> {
    return fail(UNAVAILABLE);
  }
  async scheduleLocalNotification() {
    return "";
  }
  async cancelLocalNotification() {}
  addPushTokenListener() {
    return () => {};
  }
  addNotificationReceivedListener() {
    return () => {};
  }
}
