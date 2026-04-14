# 09 — Notifications & Social: Requirements

## Overview

Push notifications (workout reminders, rest timer, PR alerts, trainer messages) and social features (friendships, workout sharing). Push tokens registered through SST API.

---

## User Stories

### STORY-001: As a user, I want to receive push notifications

**Acceptance Criteria:**

- [ ] Prompt for notification permissions on first relevant action
- [ ] Register device push token with SST API
- [ ] Receive notifications for: workout reminders, PR achievements, trainer messages
- [ ] Notification preferences controllable in settings
- [ ] Deep link from notification opens relevant screen

### STORY-002: As a user, I want rest timer notifications when the app is backgrounded

**Acceptance Criteria:**

- [ ] Local notification fires when rest timer completes
- [ ] Works without network (local scheduling)
- [ ] Tapping notification returns to active session

### STORY-003: As a user, I want to manage friendships

**Acceptance Criteria:**

- [ ] Send friend request (by user search or invite link)
- [ ] Accept/decline friend requests
- [ ] View friends list
- [ ] Remove friend
- [ ] Friendship status: pending, accepted, blocked
- [ ] Friend requests visible in notifications

### STORY-004: As a user, I want to see friends' public/shared workouts

**Acceptance Criteria:**

- [ ] Friends' workouts with "friends" visibility appear in a shared feed
- [ ] Can copy a friend's workout to own library
- [ ] Cannot edit friend's workout

### STORY-005: As a user, I want an in-app notification centre

**Acceptance Criteria:**

- [ ] Notification list screen (bell icon in header)
- [ ] Unread badge count
- [ ] Mark as read on tap
- [ ] Notification types: friend request, PR achievement, trainer assignment, system message
- [ ] Pull to refresh
