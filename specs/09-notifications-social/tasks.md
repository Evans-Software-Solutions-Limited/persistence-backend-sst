# 09 — Notifications & Social: Tasks

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

- [ ] Extend `ApiPort` with notification methods (list, mark read)
- [ ] Extend `ApiPort` with friendship methods (list, send request, accept, decline, remove, block)
- [ ] Implement in SST API adapter
- [ ] Write tests

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

- [ ] Create `FriendCard` presenter (name, avatar, status, actions)
- [ ] Create `FriendListPresenter` (friends list, pending requests section)
- [ ] Create `FriendListContainer` (fetches friends, handles actions)
- [ ] Create `FriendRequestPresenter` (search user, send request)
- [ ] Create `FriendRequestContainer` (search, send request)
- [ ] Create screens: `app/(app)/friends/index.tsx`
- [ ] Write tests

## Phase 8: Shared Workouts

- [ ] Implement friends' shared workouts feed query
- [ ] Create "copy to my workouts" action
- [ ] Write tests

## Phase 9: Quality Gates

- [ ] All notification/social tests pass with 90% coverage
- [ ] Quality gates pass
