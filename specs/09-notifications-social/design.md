# 09 — Notifications & Social: Technical Design

## Domain Models

```typescript
// src/domain/models/notification.ts
export interface AppNotification {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  message: string | null;
  data: NotificationData;
  isRead: boolean;
  readAt: string | null;
  relatedEntityType: string | null;
  relatedEntityId: string | null;
  createdAt: string;
}

/**
 * Reconciled to match the DB enum (`packages/db/src/schema.ts:139-149`),
 * which is the source of truth. The mobile `NotificationType` mirrors
 * this exactly — no drift permitted. Adding a new type requires (1) a
 * Drizzle/SQL migration extending the enum and (2) a follow-up update
 * here + in mobile.
 */
export type NotificationType =
  | "workout_assigned"
  | "friend_request"
  | "pt_request"
  | "pt_accepted"
  | "physio_request"
  | "physio_accepted"
  | "workout_reminder"
  | "goal_milestone"
  | "trainer_feedback";

export interface NotificationData {
  /**
   * Single optional deep-link field — see § Deep Linking. When absent,
   * tapping the notification opens the in-app list without navigating
   * to a target screen.
   */
  deepLink?: string;
  // Forward-compat: additional opaque keys are permitted but the only
  // contract-bearing one is `deepLink`. Clients MUST ignore unknown keys.
  [k: string]: unknown;
}

// src/domain/models/friendship.ts (DEFERRED beyond M7)
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

## Notifications Port (mobile)

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
components/NotificationBadge.tsx            # Unread count
components/NotificationItem.tsx             # Single notification row
# Friend-related components — DEFERRED beyond M7.
```

## Backend endpoints

All endpoints are mounted on the `@persistence/core` Elysia app. Auth is
Supabase JWT validated by `requireAuth`; `userId` is read from
`getUser(ctx).sub` and is the only acceptable source. Bodies never carry
user identity. Mutations fold ownership into the WHERE clause (M2
learning #14).

### `POST /devices/register`

Upsert a push device for the authenticated user. Mirrors the legacy
`register_device_token` SQL function
(`supabase/migrations/007_trainer_invitations_and_push_notifications.sql:521-580`)
but as an explicit SST handler that reads `userId` from the JWT, never
from the request body.

- **Method:** `POST`
- **Path:** `/devices/register`
- **Auth:** required.
- **Body:**
  ```typescript
  {
    deviceToken: string;            // Expo push token, opaque
    platform: "ios" | "android" | "web";
    deviceInfo?: {
      deviceName?: string;
      osVersion?: string;
      appVersion?: string;
      modelName?: string;
    };
  }
  ```
- **Response 200:** `{ data: { id: string, registered: true } }`
- **Response 400:** validation error (missing `deviceToken`, invalid
  `platform`).
- **Response 401:** missing or invalid JWT.

Idempotency: the unique index `user_devices_user_token_idx` keyed on
`(user_id, device_token)` makes the underlying
`INSERT … ON CONFLICT DO UPDATE` UPSERT idempotent. Re-registering the
same token returns the same `id` and flips `is_active` back to `true`.

### `GET /notifications`

List the user's notifications, ordered by `created_at DESC`.

- **Method:** `GET`
- **Path:** `/notifications`
- **Auth:** required.
- **Query params:**
  ```typescript
  {
    limit?: number;       // default 50, clamped to 1..100
    offset?: number;      // default 0
    unreadOnly?: boolean; // default false
  }
  ```
- **Response 200:**
  ```typescript
  {
    data: AppNotification[];
    unreadCount: number;  // total unread for the user, NOT just this page
  }
  ```

`unreadCount` powers the bell-icon badge without a second round-trip.

### `PATCH /notifications/:id`

Mark a single notification as read. Idempotent.

- **Method:** `PATCH`
- **Path:** `/notifications/:id`
- **Auth:** required.
- **Body:** `{ isRead: true }`
- **Response 200:** `{ data: AppNotification }` (the updated row).
- **Response 404:** not found OR not owned by the caller (existence
  is not leaked across users).

Ownership is folded into the mutation's `WHERE` clause — single round
trip, race-free, same 404 for "doesn't exist" and "not yours". Replaying
the mutation from the offline sync queue against an already-read row is
a no-op that still returns 200.

### `PATCH /notifications/all`

Mark every unread notification for the user as read.

- **Method:** `PATCH`
- **Path:** `/notifications/all`
- **Auth:** required.
- **Body:** `{}`
- **Response 200:** `{ data: { updated: number } }` — count of rows
  newly flipped from `is_read = false` to `is_read = true`.

Idempotent: a second call returns `{ updated: 0 }`.

**Routing note:** `/notifications/all` MUST be registered before
`/notifications/:id` in `api.ts`. Elysia routes top-down and the literal
`all` would otherwise be captured as `:id = "all"`. There's a regression
test for this.

### `GET /notifications/preferences`

Read the user's per-type notification preference map.

- **Method:** `GET`
- **Path:** `/notifications/preferences`
- **Auth:** required.
- **Response 200:**
  ```typescript
  {
    data: Record<NotificationType, boolean>;
  }
  ```
- **Response 404:** profile row missing (defensive — shouldn't fire in
  steady state since `handle_new_user` populates `profiles` at sign-up).

Empty / missing keys default to `true` (notifications enabled). See
§ Notification preferences for the storage contract.

### `POST /notifications/preferences`

Replace the user's preference map. Full-replace semantics (NOT partial
merge) — the body IS the new map.

- **Method:** `POST`
- **Path:** `/notifications/preferences`
- **Auth:** required.
- **Body:** `Record<NotificationType, boolean>` — keys must be a subset
  of `NotificationType`; values must be booleans.
- **Response 200:** `{ data: Record<NotificationType, boolean> }` —
  echoes the stored map after default-fill.
- **Response 400:** unknown key OR non-boolean value.

## Notification preferences

**Storage:** JSONB column `profiles.notification_preferences` of type
`Record<NotificationType, boolean>`. NOT NULL, DEFAULT `'{}'::jsonb`. The
`{}` default reads back as "all-true" after the handler applies defaults.

**Rationale (option B over a separate table):** Brad's call — small,
low-frequency payload; matches the legacy app's pattern of keeping user
prefs on the profile row; one additive migration vs a new table + RLS
policies. Surfaced for review in the PR — flag here if a future use case
needs row-level granularity that a JSONB column can't serve cleanly.

**Migration:** additive (`ADD COLUMN IF NOT EXISTS … JSONB NOT NULL
DEFAULT '{}'::jsonb`). See
`supabase/migrations/<timestamp>_m7_notification_preferences.sql`.

**Default shape (synthesised by the read handler when the column is `{}`):**

```typescript
{
  workout_assigned: true,
  friend_request: true,
  pt_request: true,
  pt_accepted: true,
  physio_request: true,
  physio_accepted: true,
  workout_reminder: true,
  goal_milestone: true,
  trainer_feedback: true,
}
```

**Stale-key handling:** the read handler drops keys not present in the
current `NotificationType` enum. Stored stale keys persist in the JSONB
until the next write — they're harmless because the read handler is the
contract surface and never surfaces them.

**Trigger safety:** writing to `profiles.notification_preferences` does
NOT fire `update_subscription_limits_trigger` (which watches subscription
columns only). No cross-cutting side effects.

## Push delivery

SST handlers do NOT send pushes directly. The delivery pipe is owned by
the legacy Supabase project (`dfeyebgdktfteqlacmru`) and stays untouched
by M7:

1. A row is INSERTed into `notifications` (legacy RPCs today; M8 will
   add SST-driven inserts later).
2. The Postgres trigger `notification_push_trigger`
   (`supabase/migrations/010_trigger_push_notifications.sql`) fires
   `AFTER INSERT`.
3. The trigger function `trigger_push_notification` looks up active
   `user_devices` rows for the recipient and calls the
   `send-push-notification` Supabase Edge Function via
   `pg_net.http_post`, passing `(user_id, title, message, data,
   notification_type)`.
4. The Edge Function reads the user's devices, formats Expo Push
   messages, and POSTs to `https://exp.host/--/api/v2/push/send`.
5. Expo Push fans out to APNs (iOS) + FCM (Android) using credentials
   stored under Expo project `255d542d-8dae-43c9-8d98-d9a3a325a470`.

M7's backend handlers ensure `user_devices` rows are written from SST
when the V2 app signs in — closing the loop so V2 device tokens land in
the table the trigger reads.

## Push Token Flow (mobile)

1. App requests notification permissions (`expo-notifications`).
2. Gets Expo push token via `Notifications.getDevicePushTokenAsync()`.
3. Registers token with SST API (`POST /devices/register`).
4. Backend upserts on `(userId, deviceToken)`.
5. On a future notification INSERT, the legacy Supabase trigger picks
   the device up and sends the push (see § Push delivery).

## Local Notifications

Rest timer and workout reminders use `expo-notifications` local
scheduling — no server involved. This works offline and without push
permissions on some platforms. Owned by M3; M7 leaves the surface alone.

## Deep Linking

Notifications carry an optional deep-link field on `data`:

```typescript
data.deepLink: string | undefined
```

`deepLink` is an Expo Router path. Mobile rejects anything that doesn't
start with `/(app)/` or `/(auth)/` (e.g. external `http://…` URLs are
ignored) — see `isValidDeepLink` in the mobile codebase.

Examples:

```jsonc
{ "deepLink": "/(app)/(tabs)/profile" }
{ "deepLink": "/(app)/session?sessionId=abc" }
{ "deepLink": "/(app)/(tabs)/workouts" }
```

No legacy free-form `{ screen, id }` shape — one field, type-safe.
Notifications without `deepLink` simply mark-read on tap without
navigating away.
