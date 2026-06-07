/**
 * Production NotificationsPort adapter for Expo's local-notifications API.
 *
 * Used by `useRestTimer` (M3) to fire a "Rest complete" alert when the
 * timer reaches zero — even with the app backgrounded. Permission
 * request happens on first session start, not at app launch
 * (FRONTEND_BRIEF § Group C / EXECUTION_PLAN § 5).
 *
 * Push tokens land in 09.2: `getDevicePushToken` wraps
 * `getDevicePushTokenAsync`, and the listener subscriptions back the
 * push-registration + foreground-refresh flow in `usePushNotifications`.
 *
 * Spec: specs/05-active-session/requirements.md STORY-003
 *       specs/09-notifications-social/requirements.md STORY-004
 */

import * as Notifications from "expo-notifications";
import type {
  LocalNotification,
  NotificationsPort,
  NotificationError,
} from "@/domain/ports/notifications.port";
import { fail, ok, type Result } from "@/shared/errors";

export class ExpoNotificationsAdapter implements NotificationsPort {
  async requestPermissions(): Promise<
    Result<"granted" | "denied", NotificationError>
  > {
    try {
      const result = await Notifications.requestPermissionsAsync();
      return ok(result.status === "granted" ? "granted" : "denied");
    } catch (err) {
      return fail({
        kind: "notification",
        code: "permission_denied",
        message:
          err instanceof Error ? err.message : "Permission request failed",
      });
    }
  }

  async getPermissionStatus(): Promise<
    "granted" | "denied" | "not_determined"
  > {
    const result = await Notifications.getPermissionsAsync();
    if (result.status === "granted") return "granted";
    if (result.status === "denied") return "denied";
    return "not_determined";
  }

  async getDevicePushToken(): Promise<Result<string, NotificationError>> {
    try {
      const result = await Notifications.getDevicePushTokenAsync();
      const token =
        typeof result.data === "string" ? result.data : String(result.data);
      return ok(token);
    } catch (err) {
      return fail({
        kind: "notification",
        code: "token_failed",
        message:
          err instanceof Error
            ? err.message
            : "Failed to get device push token",
      });
    }
  }

  addPushTokenListener(listener: (token: string) => void): () => void {
    const sub = Notifications.addPushTokenListener((token) => {
      listener(
        typeof token.data === "string" ? token.data : String(token.data),
      );
    });
    return () => sub.remove();
  }

  addNotificationReceivedListener(listener: () => void): () => void {
    const sub = Notifications.addNotificationReceivedListener(() => {
      listener();
    });
    return () => sub.remove();
  }

  async scheduleLocalNotification(
    notification: LocalNotification,
  ): Promise<string> {
    const trigger =
      notification.triggerSeconds && notification.triggerSeconds > 0
        ? ({
            type: "timeInterval",
            seconds: notification.triggerSeconds,
            repeats: false,
          } as unknown as Notifications.NotificationTriggerInput)
        : null;

    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: notification.title,
        body: notification.body,
        data: notification.data,
      },
      trigger,
    });
    return id;
  }

  async cancelLocalNotification(id: string): Promise<void> {
    await Notifications.cancelScheduledNotificationAsync(id);
  }
}
