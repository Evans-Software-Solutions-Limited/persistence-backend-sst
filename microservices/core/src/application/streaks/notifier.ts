/**
 * Adapts the streak engine's {@link StreakNotifier} port onto the shared
 * NotificationRepository writer (06-progress-goals, Phase 06.2 / 06.3).
 *
 * Per cross-cuts § 5 these events default opt-in "on"; per-user preference
 * gating lives in M7's (09-notifications-social) delivery layer, so this
 * writer always persists the row. M7 owns rendering + push delivery.
 */

import { NotificationRepository } from "../repositories/notificationRepository";
import type { StreakNotification, StreakNotifier } from "./engine";

export class StreakNotificationDispatcher implements StreakNotifier {
  private readonly notifications: NotificationRepository;

  // NB: explicit field assignment, not a TS parameter-property — the web
  // package typechecks core with `erasableSyntaxOnly`, which bans the
  // `constructor(private readonly …)` shorthand.
  constructor(
    notifications: NotificationRepository = new NotificationRepository(),
  ) {
    this.notifications = notifications;
  }

  async notify(notification: StreakNotification): Promise<void> {
    await this.notifications.create(notification.userId, {
      type: notification.type,
      title: notification.title,
      message: notification.message,
      data: notification.data,
      relatedEntityType: "streak",
      relatedEntityId: notification.relatedEntityId,
    });
  }
}
