import {
  NotificationRepository,
  type AppNotification,
  type CreateNotificationInput,
} from "../../repositories/notificationRepository";
import {
  UserDeviceRepository,
  type ActiveDeviceToken,
} from "../../repositories/userDeviceRepository";
import {
  ProfileRepository,
  NOTIFICATION_PREFERENCES_PROFILE_MISSING,
} from "../../repositories/profileRepository";
import {
  sendExpoPushMessages,
  type ExpoPushMessage,
  type ExpoPushTicket,
} from "./expoPushClient";

/**
 * Injectable Expo send function — `sendExpoPushMessages` in production, a stub
 * in tests. Kept as a type alias so the dispatcher constructor signature reads
 * cleanly.
 */
export type ExpoPushSender = (
  messages: ExpoPushMessage[],
) => Promise<ExpoPushTicket[]>;

/**
 * Persists an in-app notification, then best-effort delivers a push to the
 * recipient's active devices (09.9 / A3).
 *
 * Wraps the existing `NotificationRepository.create` choke point so EVERY
 * producer (streak engine, trainer invite-code accept, future coach↔client
 * events) gets push for free, with no new endpoint. Decoupling guarantee: the
 * in-app row is committed BEFORE the push is attempted, and every push failure
 * is caught + logged — a delivery error never throws back to the producer and
 * never loses the row (requirements STORY-008 AC 8.4).
 *
 * Spec: specs/09-notifications-social/design.md § ADDENDUM 2026-06-29
 *       > notificationDispatcher.ts. Satisfies STORY-008 + STORY-009.
 */
export class NotificationDispatcher {
  private readonly notifications: NotificationRepository;
  private readonly devices: UserDeviceRepository;
  private readonly profiles: ProfileRepository;
  private readonly send: ExpoPushSender;

  // NB: explicit field assignment, not TS parameter-properties — the web
  // package typechecks core with `erasableSyntaxOnly`, which bans the
  // `constructor(private readonly …)` shorthand (matches notifier.ts).
  constructor(
    notifications: NotificationRepository = new NotificationRepository(),
    devices: UserDeviceRepository = new UserDeviceRepository(),
    profiles: ProfileRepository = new ProfileRepository(),
    send: ExpoPushSender = sendExpoPushMessages,
  ) {
    this.notifications = notifications;
    this.devices = devices;
    this.profiles = profiles;
    this.send = send;
  }

  /**
   * Persist the in-app notification row, then attempt a push. Returns the
   * persisted row. `userId` is the recipient — supplied by the trusted emitter
   * (the JWT subject of the triggering event), never from a request body.
   */
  async createAndDispatch(
    userId: string,
    input: CreateNotificationInput,
  ): Promise<AppNotification> {
    const row = await this.notifications.create(userId, input);

    try {
      await this.dispatchPush(userId, row);
    } catch (err) {
      // Best-effort: the in-app row is already committed. A push failure
      // (network, Expo 5xx, pref/device lookup error) must never escape.
      console.warn(
        `[push] dispatch failed for notification ${row.id} (${row.type}):`,
        err,
      );
    }

    return row;
  }

  /**
   * Preference-gated, device-scoped fan-out for a single persisted row.
   * Separated so the error isolation in `createAndDispatch` wraps the whole
   * lookup→send→retire sequence.
   */
  private async dispatchPush(
    userId: string,
    row: AppNotification,
  ): Promise<void> {
    // Per-type preference gate. Missing profile → skip silently (row kept).
    const prefs = await this.profiles.getNotificationPreferences(userId);
    if (prefs === NOTIFICATION_PREFERENCES_PROFILE_MISSING) return;
    // Opt-out model: only an explicit `false` mutes. Unknown/missing → push.
    if (prefs[row.type] === false) return;

    const devices = await this.devices.listActiveTokens(userId);
    if (devices.length === 0) return;

    const messages = devices.map((device) => toExpoMessage(device, row));
    const tickets = await this.send(messages);

    await this.retireDeadTokens(userId, devices, tickets);
  }

  /**
   * Zip `tickets[i] ↔ devices[i]` (the Expo response preserves request order)
   * and deactivate any device whose ticket is a `DeviceNotRegistered` error.
   * Other ticket errors are logged but not acted on. Each deactivation is
   * individually isolated so one failure can't abort the rest.
   */
  private async retireDeadTokens(
    userId: string,
    devices: ActiveDeviceToken[],
    tickets: ExpoPushTicket[],
  ): Promise<void> {
    for (let i = 0; i < devices.length; i += 1) {
      const ticket = tickets[i];
      if (ticket === undefined || ticket.status !== "error") continue;

      const errorCode = ticket.details?.error;
      if (errorCode === "DeviceNotRegistered") {
        try {
          await this.devices.deactivateToken(userId, devices[i].deviceToken);
        } catch (err) {
          console.warn(
            `[push] failed to deactivate dead token for user ${userId}:`,
            err,
          );
        }
      } else {
        console.warn(
          `[push] ticket error for user ${userId}: ${
            errorCode ?? ticket.message ?? "unknown"
          }`,
        );
      }
    }
  }
}

/**
 * Map a persisted notification + target token to an Expo push message. Mirrors
 * the legacy Edge Function's shape (`sound`/`priority`/`channelId`) and carries
 * `notification_type` + `deepLink` in `data` so the mobile tap handler can
 * route. Exported for unit testing.
 */
export function toExpoMessage(
  device: ActiveDeviceToken,
  row: AppNotification,
): ExpoPushMessage {
  const data: Record<string, unknown> = {
    ...row.data,
    notification_type: row.type,
    notification_id: row.id,
  };
  // Canonicalise: producers may set `deeplink` (lowercase, e.g.
  // trainersAcceptInviteCodeHandler) or `deepLink` (camelCase). The mobile
  // tap handler reads `data.deepLink`; promote the lowercase variant so it's
  // consistently available regardless of producer convention.
  if (typeof data.deeplink === "string" && data.deepLink === undefined) {
    data.deepLink = data.deeplink;
  }

  return {
    to: device.deviceToken,
    title: row.title,
    body: row.message ?? "",
    sound: "default",
    priority: "high",
    channelId: "default",
    data,
  };
}
