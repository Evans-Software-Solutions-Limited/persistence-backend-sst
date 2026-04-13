# 09 — Notifications & Social: Technical Design

## Domain Models

```typescript
// src/domain/models/notification.ts
export interface AppNotification {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  data: Record<string, string>; // deep link params
  isRead: boolean;
  createdAt: string;
}

export type NotificationType =
  | "friend_request"
  | "friend_accepted"
  | "personal_record"
  | "trainer_assignment"
  | "workout_reminder"
  | "system";

// src/domain/models/friendship.ts
export interface Friendship {
  id: string;
  requesterId: string;
  addresseeId: string;
  status: FriendshipStatus;
  requesterName: string;
  addresseeName: string;
  createdAt: string;
}

export type FriendshipStatus = "pending" | "accepted" | "blocked";
```

## Notifications Port

```typescript
// src/domain/ports/notifications.port.ts
export interface NotificationsPort {
  requestPermissions(): Promise<
    Result<"granted" | "denied", NotificationError>
  >;
  getPermissionStatus(): Promise<"granted" | "denied" | "not_determined">;
  registerPushToken(token: string): Promise<Result<void, NotificationError>>;
  scheduleLocalNotification(notification: LocalNotification): Promise<string>; // returns notification ID
  cancelLocalNotification(id: string): Promise<void>;
  getDevicePushToken(): Promise<Result<string, NotificationError>>;
}
```

## UI Components

```
containers/NotificationListContainer.tsx    # Fetches notifications
presenters/NotificationListPresenter.tsx    # Notification list
containers/FriendListContainer.tsx          # Fetches friends
presenters/FriendListPresenter.tsx          # Friend list
containers/FriendRequestContainer.tsx       # Send/accept requests
presenters/FriendRequestPresenter.tsx       # Request UI
components/NotificationBadge.tsx            # Unread count
components/NotificationItem.tsx             # Single notification row
components/FriendCard.tsx                   # Friend with actions
```

## Push Token Flow

1. App requests notification permissions (expo-notifications)
2. Gets Expo push token
3. Registers token with SST API (`POST /notifications/register-token`)
4. Backend stores token for the user
5. Backend sends push via Expo Push API when events occur

## Local Notifications

Rest timer and workout reminders use `expo-notifications` local scheduling — no server involved. This works offline and without push permissions (on some platforms).

## Deep Linking

Notifications contain `data` with route info:

```typescript
{ screen: 'session', id: 'abc-123' }
{ screen: 'notifications', type: 'friend_request' }
```

Expo Router handles deep links from notification taps.
