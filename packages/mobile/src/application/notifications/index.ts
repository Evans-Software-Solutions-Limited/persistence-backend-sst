export {
  type NotificationsListQueryResult,
  getNotificationsQuery,
  refreshNotifications,
} from "./queries/list-notifications.query";
export {
  getUnreadCountQuery,
  refreshUnreadCount,
} from "./queries/unread-count.query";
export {
  getPreferencesQuery,
  refreshPreferences,
} from "./queries/preferences.query";

export {
  type NotificationGroup,
  type NotificationGroupLabel,
  groupNotificationsByDate,
  relativeTime,
} from "./grouping";
export { HOME_ROUTE, resolveNotificationRoute } from "./deep-link";

export {
  type Clock,
  markNotificationReadCommand,
} from "./commands/mark-read.command";
export { markAllNotificationsReadCommand } from "./commands/mark-all-read.command";
export { updateNotificationPreferencesCommand } from "./commands/update-preferences.command";
