# 09 — Notifications & Social: Requirements

## Overview

Push notifications (workout reminders, rest timer, PR alerts, trainer messages) and social features (friendships, workout sharing). Push tokens registered through SST API.

M7 ships only the notifications half — STORY-001, STORY-002 (already
shipped under M3), and STORY-005 are in scope. STORY-003 + STORY-004
plus the friendships portion of STORY-005 are deferred beyond M7. See
`specs/milestones/M7-notifications/BRIEF.md`.

---

## User Stories

### STORY-001: As a user, I want to receive push notifications

**Acceptance Criteria:**

- [ ] Prompt for notification permissions on first relevant action
- [ ] Register device push token with SST API
- [ ] Receive notifications for: workout reminders, PR achievements, trainer messages
- [ ] Notification preferences controllable in settings
- [ ] Deep link from notification opens relevant screen

**M7 detailed ACs** (each maps 1:1 to a step in
`specs/milestones/M7-notifications/SMOKE_TEST.md`):

- **AC 1.1 — Device-token registration on sign-in.** A fresh authed
  render after sign-in calls `POST /devices/register` exactly once with
  `{ deviceToken, platform, deviceInfo? }`. The handler upserts on
  `(userId, deviceToken)`. Response 200 returns `{ data: { id, registered: true } }`.
  AsyncStorage flag `device_token_registered_<userId>` set on success.
  Maps to SMOKE_TEST Step 1.
- **AC 1.2 — Idempotent re-registration.** Signing out and signing back
  in as the same user, with the flag cleared, results in one
  `POST /devices/register` call that returns the SAME `id` as the
  initial registration. `SELECT COUNT(*) FROM user_devices WHERE
  user_id = ?` is 1. Maps to SMOKE_TEST Step 2.
- **AC 1.3 — Push delivery end-to-end.** Inserting a `notifications`
  row directly via SQL causes the legacy Supabase trigger to fire the
  `send-push-notification` Edge Function which delivers a banner to
  the device. SST does NOT send pushes itself — this is the regression
  check that V2 device tokens are picked up by the legacy pipe. Maps
  to SMOKE_TEST Step 3.
- **AC 1.4 — Deep-link tap, warm-start.** Tapping the banner with the
  app foregrounded or backgrounded reads
  `notification.request.content.data.deepLink` and calls `router.push`
  on the validated path. Maps to SMOKE_TEST Step 4.
- **AC 1.5 — Deep-link tap, cold-start.** Tapping the banner with the
  app force-quit cold-launches the app; the mount-time handler reads
  `getLastNotificationResponseAsync` and routes to `data.deepLink`
  after the auth gate settles. Maps to SMOKE_TEST Step 5.
- **AC 1.6 — Deep-link safety.** Any `deepLink` that doesn't start
  with `/(app)/` or `/(auth)/` is silently rejected — no navigation,
  no error toast. Maps to SMOKE_TEST Step 14.
- **AC 1.7 — Preferences round-trip.** `GET /notifications/preferences`
  returns the user's full map with defaults filled for missing keys.
  `POST /notifications/preferences` with a full map persists into
  `profiles.notification_preferences` JSONB. Toggling and re-reading
  reflects the new value. Maps to SMOKE_TEST Step 10.
- **AC 1.8 — Preferences validation.** `POST` with an unknown key OR
  a non-boolean value returns 400. Maps to SMOKE_TEST quality-gate
  block.

### STORY-002: As a user, I want rest timer notifications when the app is backgrounded

**Acceptance Criteria:**

- [ ] Local notification fires when rest timer completes
- [ ] Works without network (local scheduling)
- [ ] Tapping notification returns to active session

Shipped under M3. M7 does not touch this surface.

### STORY-003: As a user, I want to manage friendships

**Acceptance Criteria:**

- [ ] Send friend request (by user search or invite link)
- [ ] Accept/decline friend requests
- [ ] View friends list
- [ ] Remove friend
- [ ] Friendship status: pending, accepted, blocked
- [ ] Friend requests visible in notifications

DEFERRED beyond M7.

### STORY-004: As a user, I want to see friends' public/shared workouts

**Acceptance Criteria:**

- [ ] Friends' workouts with "friends" visibility appear in a shared feed
- [ ] Can copy a friend's workout to own library
- [ ] Cannot edit friend's workout

DEFERRED beyond M7.

### STORY-005: As a user, I want an in-app notification centre

**Acceptance Criteria:**

- [ ] Notification list screen (bell icon in header)
- [ ] Unread badge count
- [ ] Mark as read on tap
- [ ] Notification types: friend request, PR achievement, trainer assignment, system message
- [ ] Pull to refresh

**M7 detailed ACs** (the friend-request item type is deferred along with
STORY-003; the rest ship in M7):

- **AC 5.1 — List endpoint contract.** `GET /notifications` returns
  `{ data: AppNotification[], unreadCount: number }` where `data` is
  ordered `created_at DESC` and scoped to the JWT `userId`. Supports
  `?limit` (default 50, clamped to 1..100), `?offset` (default 0),
  `?unreadOnly=true`. Maps to SMOKE_TEST Step 7 + Step 15.
- **AC 5.2 — Bell badge.** The mobile bell-icon header shows
  `unreadCount` from the list response; tapping the bell routes to the
  notifications list. Maps to SMOKE_TEST Step 6.
- **AC 5.3 — Mark-read single.** `PATCH /notifications/:id` with body
  `{ isRead: true }` flips the row, returns the updated row. Wrong
  user (or missing) returns 404 from the same code path — ownership
  folded into the WHERE clause (M2 learning #14). Replays of an
  already-read row are a no-op that returns 200. Maps to SMOKE_TEST
  Step 8 + Step 13.
- **AC 5.4 — Mark-all-read.** `PATCH /notifications/all` with empty
  body returns `{ data: { updated: number } }` and only touches the
  caller's unread rows. Maps to SMOKE_TEST Step 9 + Step 13.
- **AC 5.5 — Routing collision regression.**
  `PATCH /notifications/all` is registered before
  `PATCH /notifications/:id` in `api.ts` so the literal `all` is not
  captured as `:id`. Tested by hitting `/notifications/all` and
  asserting the bulk handler ran. Maps to SMOKE_TEST quality-gate
  block.
- **AC 5.6 — Offline cached read.** Opening the list while offline
  renders from the mobile SQLite cache with an offline banner. (Mobile
  responsibility — backend is unaffected.) Maps to SMOKE_TEST Step 11.
- **AC 5.7 — Offline mark-read replay.** A mark-read mutation issued
  while offline enqueues into the M3 sync queue and replays on
  reconnect; the server handler is idempotent so the replay returns
  200 even if the row was already read. Maps to SMOKE_TEST Step 12.
- **AC 5.8 — Ownership defence.** A user attempting to mark-read or
  list another user's notifications gets 404 (mark) or empty `data`
  (list) — no cross-user reads or writes leak. Maps to SMOKE_TEST
  Step 13.
