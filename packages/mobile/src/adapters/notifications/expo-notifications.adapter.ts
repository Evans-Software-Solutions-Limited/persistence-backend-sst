/**
 * Production NotificationsPort adapter for Expo's local-notifications API.
 *
 * Used by `useRestTimer` (M3) to fire a "Rest complete" alert when the
 * timer reaches zero — even with the app backgrounded. Permission
 * request happens on first session start, not at app launch
 * (FRONTEND_BRIEF § Group C / EXECUTION_PLAN § 5).
 *
 * Push tokens are out of scope for M3 — `getDevicePushToken` returns
 * a not-yet-implemented error so the type contract holds; M9 ships the
 * push delivery surface.
 *
 * Spec: specs/05-active-session/requirements.md STORY-003
 */

import * as Notifications from "expo-notifications";
import type {
  LocalNotification,
  NotificationsPort,
  NotificationError,
} from "@/domain/ports/notifications.port";
import { fail, ok, type Result } from "@/shared/errors";

const PUSH_NOT_IMPLEMENTED: NotificationError = {
  kind: "notification",
  code: "token_failed",
  message: "Push tokens are not implemented in M3 — see milestone 09.",
};

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
    return fail(PUSH_NOT_IMPLEMENTED);
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
