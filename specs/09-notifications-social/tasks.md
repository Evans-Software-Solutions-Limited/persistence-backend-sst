# 09 — Notifications & Social: Tasks

## Current state (2026-04-19)

**Shipped: ~1 of ~40 tasks complete. Stub adapter only, no backend.**

What's there:

- `NotificationsPort` interface at `src/domain/ports/notifications.port.ts` (shipped as part of 00-guardrails).
- `StubNotificationsAdapter` at `src/adapters/notifications/stub.adapter.ts` — no-op placeholder.
- **Backend** — no notifications endpoints, no friendships endpoints.

Nothing real is built: no Expo notifications integration, no push-token registration, no notification-centre UI, no friendship flows, no shared-workouts feed.

Parent milestones:

- **M7 Notifications** — adds full notifications surface (`GET /notifications`, `PATCH /notifications/:id`, `PATCH /notifications/all`, `GET+POST /notifications/preferences`, `POST /devices/register`), `NotificationsContainer` + presenter with tap-to-deep-link, preferences screen with toggle switches, device-token registration on sign-in. **Social / friendships are explicitly deferred beyond M7** — this spec's original scope splits social (feed, friendships, shared workouts) from pure notifications, and the milestone plan keeps only the latter for M7.

## Phase 1: Domain

- [ ] Create `AppNotification`, `NotificationType` models
- [ ] Create `Friendship`, `FriendshipStatus` models
- [ ] Write model validation tests

## Phase 2: Notifications Port & Adapter

- [ ] Define `NotificationsPort` interface
- [ ] Add `expo-notifications` dependency
- [ ] Create Expo notifications adapter (permissions, push token, local scheduling)
- [ ] Create mock notifications adapter for tests
- [ ] Write adapter tests

## Phase 3: Push Token Registration

- [ ] Implement push token registration flow (get token → POST to API)
- [ ] Handle token refresh
- [ ] Write tests

## Phase 4: Local Notifications

- [ ] Integrate rest timer with local notification scheduling
- [ ] Implement workout reminder scheduling (from preferences)
- [ ] Write tests

## Phase 5: API — Notification & Friendship Endpoints

**M7 scope** — notification endpoints only. Friendship endpoints
deferred (see Phase 7).

- [ ] Extend `ApiPort` with notification methods (list, mark read)
- [ ] Backend: `POST /devices/register` — device-token upsert (M7)
- [ ] Backend: `GET /notifications` — list with `limit/offset/unreadOnly` + `unreadCount` (M7)
- [ ] Backend: `PATCH /notifications/:id` — single mark-read, ownership-folded WHERE (M7)
- [ ] Backend: `PATCH /notifications/all` — bulk mark-read, idempotent (M7)
- [ ] Backend: `GET /notifications/preferences` — read JSONB on `profiles` (M7)
- [ ] Backend: `POST /notifications/preferences` — full-replace write (M7)
- [ ] Migration: `profiles.notification_preferences JSONB NOT NULL DEFAULT '{}'::jsonb` (M7)
- [ ] DEFERRED: Extend `ApiPort` with friendship methods (list, send request, accept, decline, remove, block)
- [ ] DEFERRED: Implement friendships in SST API adapter
- [ ] Write tests (M7 — handler + repository, ≥90% coverage on changed files)

## Phase 6: UI — Notification Centre

- [ ] Create `NotificationItem` presenter (icon, title, body, time, read state)
- [ ] Create `NotificationBadge` component (unread count)
- [ ] Create `NotificationListPresenter` (list, pull to refresh, empty state)
- [ ] Create `NotificationListContainer` (fetches, marks read on tap)
- [ ] Create `app/(app)/notifications.tsx` screen
- [ ] Add badge to navigation header
- [ ] Implement deep link navigation from notification tap
- [ ] Write tests

## Phase 7: UI — Friendships

**DEFERRED beyond M7.**


- [ ] Create `FriendCard` presenter (name, avatar, status, actions)
- [ ] Create `FriendListPresenter` (friends list, pending requests section)
- [ ] Create `FriendListContainer` (fetches friends, handles actions)
- [ ] Create `FriendRequestPresenter` (search user, send request)
- [ ] Create `FriendRequestContainer` (search, send request)
- [ ] Create screens: `app/(app)/friends/index.tsx`
- [ ] Write tests

## Phase 8: Shared Workouts

**DEFERRED beyond M7.**


- [ ] Implement friends' shared workouts feed query
- [ ] Create "copy to my workouts" action
- [ ] Write tests

## Phase 9: Quality Gates

- [ ] All notification/social tests pass with 90% coverage
- [ ] Quality gates pass
