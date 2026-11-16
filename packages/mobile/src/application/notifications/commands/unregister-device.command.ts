/**
 * Unregister this device's push token for the signed-in user — the sign-out
 * half of push registration (`usePushNotifications` owns the sign-in half).
 *
 * Without it, signing out left the account's `user_devices` row active, so
 * that account's pushes kept arriving on a phone it was no longer signed
 * into. Ports the legacy logout call to `unregister_device_token`.
 *
 * Must run BEFORE the session is revoked: `POST /devices/unregister` needs
 * the JWT. Best-effort and bounded — sign-out must never hang or fail on it
 * (the device may be offline). If it does not land, the backend still
 * recovers: the next account to register this token takes it over.
 */

import type { ApiPort } from "@/domain/ports/api.port";
import type { NotificationsPort } from "@/domain/ports/notifications.port";

/** How long sign-out waits for the unregister before moving on. */
export const UNREGISTER_DEVICE_TIMEOUT_MS = 3000;

export async function unregisterDeviceCommand(
  api: Pick<ApiPort, "unregisterDevice">,
  notifications: Pick<
    NotificationsPort,
    "getPermissionStatus" | "getDevicePushToken"
  >,
  timeoutMs: number = UNREGISTER_DEVICE_TIMEOUT_MS,
): Promise<void> {
  const attempt = async (): Promise<void> => {
    // No permission → this device never registered a token, so there is
    // nothing to drop. Read the status only; never prompt during sign-out.
    if ((await notifications.getPermissionStatus()) !== "granted") return;
    const token = await notifications.getDevicePushToken();
    if (!token.ok) return;
    const result = await api.unregisterDevice({ token: token.value });
    if (!result.ok) {
      console.warn(
        `[push] device unregister failed (${result.error.code}): ${
          result.error.message || "no detail"
        }`,
      );
    }
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
  });
  try {
    await Promise.race([
      attempt().catch((err: unknown) => {
        console.warn("[push] device unregister threw:", err);
      }),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
}
