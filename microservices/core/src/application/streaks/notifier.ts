/**
 * Adapts the streak engine's {@link StreakNotifier} port onto the
 * {@link NotificationDispatcher} (06-progress-goals Phase 06.2/06.3 +
 * 09-notifications-social Phase 09.9 / A3).
 *
 * Per cross-cuts § 5 these events default opt-in "on". The dispatcher persists
 * the in-app row (always) and then attempts a per-type-preference-gated push —
 * M7's (09-notifications-social) delivery layer, which previously didn't exist.
 * A push failure never loses the persisted row.
 */

import { NotificationDispatcher } from "../notifications/push/notificationDispatcher";
import type { StreakNotification, StreakNotifier } from "./engine";

export class StreakNotificationDispatcher implements StreakNotifier {
  private readonly dispatcher: NotificationDispatcher;

  // NB: explicit field assignment, not a TS parameter-property — the web
  // package typechecks core with `erasableSyntaxOnly`, which bans the
  // `constructor(private readonly …)` shorthand.
  constructor(
    dispatcher: NotificationDispatcher = new NotificationDispatcher(),
  ) {
    this.dispatcher = dispatcher;
  }

  async notify(notification: StreakNotification): Promise<void> {
    await this.dispatcher.createAndDispatch(notification.userId, {
      type: notification.type,
      title: notification.title,
      message: notification.message,
      data: notification.data,
      relatedEntityType: "streak",
      relatedEntityId: notification.relatedEntityId,
    });
  }
}
