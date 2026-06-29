/**
 * Production NotificationsPort adapter for Expo's local-notifications API.
 *
 * Used by `useRestTimer` (M3) to fire a "Rest complete" alert when the
 * timer reaches zero — even with the app backgrounded. Permission
 * request happens on first session start, not at app launch
 * (FRONTEND_BRIEF § Group C / EXECUTION_PLAN § 5).
 *
 * Push tokens land in 09.2: `getDevicePushToken` wraps
 * `getExpoPushTokenAsync` (the Expo push token, `ExponentPushToken[…]`, which
 * the backend Expo Push delivery layer in 09.9 / A3 targets — NOT the raw
 * native APNs/FCM token), and the listener subscriptions back the
 * push-registration + foreground-refresh flow in `usePushNotifications`.
 *
 * Spec: specs/05-active-session/requirements.md STORY-003
 *       specs/09-notifications-social/requirements.md STORY-004
 */

import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import type {
  LocalNotification,
  NotificationsPort,
  NotificationError,
  NotificationResponseInfo,
} from "@/domain/ports/notifications.port";
import { fail, ok, type Result } from "@/shared/errors";

/** Pull `data.deepLink` off a notification response, or null. */
function extractDeepLink(
  response: Notifications.NotificationResponse | null,
): string | null {
  const data = response?.notification?.request?.content?.data as
    | Record<string, unknown>
    | undefined;
  // Tolerate both `deepLink` (handlers/spec) and `deeplink` (DB triggers).
  const deepLink = data?.deepLink ?? data?.deeplink;
  return typeof deepLink === "string" ? deepLink : null;
}

/** Map an expo response to the port's `{ id, deepLink }` shape. */
function toResponseInfo(
  response: Notifications.NotificationResponse,
): NotificationResponseInfo {
  return {
    id: response.notification.request.identifier,
    deepLink: extractDeepLink(response),
  };
}

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
      // The Expo push token (`ExponentPushToken[…]`) is what the backend Expo
      // Push API send path targets. `getExpoPushTokenAsync` needs the EAS
      // project id to mint the token in a standalone build; read it from the
      // resolved app config (app.json → expo.extra.eas.projectId).
      const projectId =
        typeof Constants.expoConfig?.extra?.eas?.projectId === "string"
          ? (Constants.expoConfig.extra.eas.projectId as string)
          : undefined;
      const result = await Notifications.getExpoPushTokenAsync(
        projectId !== undefined ? { projectId } : undefined,
      );
      const token =
        typeof result.data === "string" ? result.data : String(result.data);
      return ok(token);
    } catch (err) {
      return fail({
        kind: "notification",
        code: "token_failed",
        message:
          err instanceof Error ? err.message : "Failed to get Expo push token",
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

  addNotificationResponseListener(
    listener: (response: NotificationResponseInfo) => void,
  ): () => void {
    const sub = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        listener(toResponseInfo(response));
      },
    );
    return () => sub.remove();
  }

  async getLastNotificationResponse(): Promise<NotificationResponseInfo | null> {
    const response = await Notifications.getLastNotificationResponseAsync();
    if (!response) return null;
    return toResponseInfo(response);
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

  async setBadgeCount(count: number): Promise<void> {
    await Notifications.setBadgeCountAsync(Math.max(0, count));
  }
}
