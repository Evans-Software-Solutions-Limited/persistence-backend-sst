# 09 — Notifications & Social: Requirements

> **Spec rewritten from scratch on 2026-05-28** to align with the May 2026 design package + the May 2027 M7-backend ship. Prior version preserved in git history.

---

## Overview

The notification surface — mobile delivery, in-app history, user preferences, deep-link dispatch. **Backend already shipped via PR #81** (2026-05-27) with 6 endpoints + JSONB preferences column + atomic partial-merge semantics. This spec covers the **mobile frontend** + ongoing notification-type registration as new event types emerge from `06-progress-goals`, `10-trainer-features`, `13-nutrition-tracking`.

"Social" remains out of scope until post-launch — no friends, no feed, no comments. The slot name is preserved for legacy continuity.

Authoritative references:

1. `specs/_shared/cross-cuts.md § 5` — notification taxonomy table (canonical list of event types + default opt-in + deep links)
2. PR #81 (merged 2026-05-27) — backend endpoint catalog + JSONB preferences shape + `mergeNotificationPreferences` semantics
3. `~/Downloads/handoff/design-source/screens/extra.jsx` lines 94 — drawer reference to "Notifications" preference row
4. `~/Downloads/handoff/design-source/screens/home.jsx` lines 76 — bell IconBtn on HomeHeader
5. `docs/design-port-audit.md` § "Profile drawer" + Home header

---

## Locked decisions

| #   | Decision                     | Locked value                                                                                                                                                                                                                           |
| --- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ------------------------------------------------------------------------------------------------------ |
| 1   | Backend status               | Already shipped — `POST /devices/register`, `GET /notifications`, `PATCH /notifications/:id`, `PATCH /notifications/all`, `GET /notifications/preferences`, `POST /notifications/preferences` (PR #81). This spec consumes them as-is. |
| 2   | Preferences shape            | JSONB column on `profiles.notification_preferences`. Per-type opt-in boolean. POST merges atomically (`                                                                                                                                |     | `); response echoes the merged column via `RETURNING`. Default opt-in values per cross-cuts § 5 table. |
| 3   | Read-state                   | `notifications.read_at` populated via `markRead` using `COALESCE(read_at, NOW())` so sync-queue replays preserve original read-moment (per PR #81 sweep 2).                                                                            |
| 4   | Notification surfaces in app | (a) bell IconBtn on Home header with unread count badge; (b) full list at `(app)/notifications` route; (c) preferences at `(app)/profile/notifications` (linked from ProfileDrawer per `08-profile-settings` STORY-006).               |
| 5   | Device token registration    | `expo-notifications` token registered on app launch + on auth change. `POST /devices/register` writes the token.                                                                                                                       |
| 6   | Deep-link dispatch           | Tap on notification (push or in-app row) routes per cross-cuts § 5 deep-link column. Routes use the `14-navigation` deep-link redirect map where needed.                                                                               |
| 7   | Notification list visual     | Vertical list of `<NotificationRow>` composites (spec-local). Grouped by date section (Today / Yesterday / This Week / Older). Unread row gets `$primaryDim` background.                                                               |
| 8   | Preferences UI               | Grouped toggle list per category (Streaks / Goals / Trainer / Nutrition). Each toggle calls `POST /notifications/preferences` with the partial-merge payload. Optimistic UI.                                                           |
| 9   | Offline                      | Notification list cached in SQLite (limit 100 rows) for offline browse. Preferences mutations queue + sync per V2 pattern. Device-token registration requires online.                                                                  |
| 10  | New event types              | Added by emitting specs (`06`, `10`, `13`). DB enum migration owned by THIS spec — every new value lands here. Default opt-in values added to cross-cuts § 5 table at the same time.                                                   |

---

## User stories

### STORY-001: As a user, I see a bell icon on Home with an unread-count badge

**Acceptance Criteria:**

- 1.1 [ ] `<HomeHeader>` (in `06-progress-goals`) renders `<IconBtn icon={<IconBell/>} tone="ghost" onPress={openNotifications}/>` per `home.jsx:76`.
- 1.2 [ ] When `unreadCount > 0`, render a small `$ember` badge top-right of the bell with the count (max display `9+` for ≥10).
- 1.3 [ ] Tap → `router.push('/(app)/notifications')`.
- 1.4 [ ] Unread count source: `useGetNotifications().data.filter(n => !n.readAt).length` (or a dedicated `useGetUnreadCount` for perf).
- 1.5 [ ] Real-time updates via `expo-notifications` `addNotificationReceivedListener` — incoming push increments badge without app restart.

### STORY-002: As a user, I want a full notifications list screen with grouped sections + tap to navigate

**Acceptance Criteria:**

- 2.1 [ ] Route `(app)/notifications.tsx` renders `<NotificationsListContainer>`.
- 2.2 [ ] Header: `<HeaderBar large title="Notifications" eyebrow="{N} UNREAD" trailing={<IconBtn icon={<IconCheck/>} tone="ghost" onPress={markAllRead}/>}>`.
- 2.3 [ ] List grouped by date section: Today / Yesterday / This Week / Older. Section headers use `<Section>` from `01-design-system`.
- 2.4 [ ] Each row uses `<NotificationRow>` (spec-local composite — see `design.md`).
- 2.5 [ ] Unread rows get `$primaryDim` background; read rows neutral.
- 2.6 [ ] Tap → fires `PATCH /notifications/:id` to mark read AND routes per cross-cuts § 5 deep-link column.
- 2.7 [ ] Pull-to-refresh refetches.
- 2.8 [ ] Empty state: "No notifications yet" + "Check back after a workout 💪" copy.
- 2.9 [ ] Pagination: `?cursor=&limit=20` query param on `GET /notifications` (already supported per PR #81 — confirm).

### STORY-003: As a user, I want a preferences screen to toggle each notification category on or off

**Acceptance Criteria:**

- 3.1 [ ] Route `(app)/profile/notifications.tsx` renders `<NotificationPreferencesContainer>`. Linked from ProfileDrawer per `08-profile-settings` STORY-006.
- 3.2 [ ] Header: `<HeaderBar compact title="Notifications" leading={<IconBtn icon={<IconBack/>} onPress={goBack}/>}>`.
- 3.3 [ ] Sections grouped by category (per cross-cuts § 5):
  - **Streaks & Achievements** — `streak_milestone`, `streak_at_risk`, `freeze_token_applied`
  - **Goals** — `goal_milestone`, `goal_assigned_by_trainer`
  - **Trainer actions** — `workout_assigned`, `workout_logged_on_behalf`, `measurement_logged_on_behalf`, `nutrition_target_set_by_trainer`, `nutrition_entry_logged_on_behalf` (M9.5+)
  - **Nutrition** — `daily_nutrition_target_hit`
- 3.4 [ ] Each row: `<DrawerRow>` (from `01-design-system`) with switch on the right.
- 3.5 [ ] Toggle calls `POST /notifications/preferences { [type]: bool }`. Atomic merge per PR #81 sweep 1. Optimistic UI.
- 3.6 [ ] Server returns the FULL merged column via `RETURNING` (per PR #81 sweep 2). Client replaces local cache with the response.
- 3.7 [ ] Default opt-in values per cross-cuts § 5 table. First-time-app-open writes defaults via POST.

### STORY-004: As a user, I want my device registered for push notifications

**Acceptance Criteria:**

- 4.1 [ ] On app launch, after auth resolves, `expo-notifications.getDevicePushTokenAsync()` runs.
- 4.2 [ ] Token is POSTed to `/devices/register { token, platform: 'ios' | 'android' }`.
- 4.3 [ ] First-time launch requests notification permission via `expo-notifications.requestPermissionsAsync()`. If denied, no token is registered (user can re-enable from Preferences screen).
- 4.4 [ ] Token re-registration on auth-change (new sign-in) and on token rotation (Expo emits change event).
- 4.5 [ ] Failed registration logged but does NOT block app launch.

### STORY-005: As a user, tapping a notification (push or in-app) routes me to the right surface

**Acceptance Criteria:**

- 5.1 [ ] Each notification's `data` payload includes a `deepLink: string` per cross-cuts § 5 table.
- 5.2 [ ] Tap on in-app row → marks read + `router.push(deepLink)`.
- 5.3 [ ] Tap on system push (cold-start or background) → `expo-notifications.useLastNotificationResponse()` fires → same dispatch.
- 5.4 [ ] Deep-link redirect map in `14-navigation` handles legacy paths transparently (e.g. `/progress` → `/(app)/(tabs)/you`).
- 5.5 [ ] Unknown deep-link gracefully falls back to `/(app)/(tabs)/index` (Home).

### STORY-006: As an offline user, I want my cached notifications list browsable and my preferences-toggle to queue

**Acceptance Criteria:**

- 6.1 [ ] Notifications list reads from SQLite cache (limit 100 rows, indexed by `created_at desc`).
- 6.2 [ ] Background refetch on app foreground + pull-to-refresh.
- 6.3 [ ] Preferences toggle queues to sync queue + writes optimistically to local cache. Server-wins on conflict.
- 6.4 [ ] Mark-read mutations: optimistic + queue. On reconnect, server uses `COALESCE(read_at, NOW())` per locked decision #3 — original read moment preserved.

### STORY-007: As a developer, when a new notification event type is introduced by a downstream spec, the DB enum migration lands here

**Acceptance Criteria:**

- 7.1 [ ] `notification_type` Postgres enum is owned by THIS spec. Migrations adding new values land in `09-notifications-social` PR companion to the downstream spec that emits them.
- 7.2 [ ] Default opt-in value for the new type is added to `_shared/cross-cuts.md § 5` table in the same PR.
- 7.3 [ ] Frontend Preferences screen (STORY-003) auto-renders new toggle once the spec is updated to list it in the category grouping.

---

## Out of scope

- **Social features** — friends list, activity feed, comments, likes. Post-launch.
- **In-app messaging / inbox** — was an Option 4 nav feature, not adopted in Option 3.
- **Email notification delivery** — push only for v1. Email channel could land post-launch.
- **Notification categories beyond cross-cuts § 5** — strictly the canonical taxonomy.
- **Rich notification content** (images, action buttons in the push) — text + icon only for v1.

---

## Dependencies and what this spec unlocks

**Depends on:**

| Spec                                 | What's consumed                                                                                                                                        |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `01-design-system`                   | `<HeaderBar>`, `<IconBtn>`, `<Section>`, `<DrawerRow>` (with toggle trailing slot), `<Pill>`, Lucide icons (`<IconBell>`, `<IconCheck>`, `<IconBack>`) |
| `14-navigation`                      | Deep-link redirect map for legacy paths                                                                                                                |
| `06-progress-goals`                  | `<HomeHeader>` bell mount-point (per STORY-001)                                                                                                        |
| `08-profile-settings`                | ProfileDrawer row "Notifications" links to `(app)/profile/notifications`                                                                               |
| `_shared/cross-cuts.md`              | § 5 notification taxonomy (canonical)                                                                                                                  |
| **Already-shipped backend (PR #81)** | All 6 endpoints + JSONB preferences                                                                                                                    |

**Unlocks:**

| Downstream spec         | What it can do once 09 lands                                                           |
| ----------------------- | -------------------------------------------------------------------------------------- |
| `06-progress-goals`     | Streak milestone / at-risk / freeze-token / goal-milestone events have a delivery path |
| `10-trainer-features`   | On-behalf + assignment events have a delivery path                                     |
| `13-nutrition-tracking` | Daily-target-hit + trainer-target-set events have a delivery path                      |

---

## Open questions

None. All 10 decisions locked.

---

_End of `09-notifications-social/requirements.md` · 2026-05-28 (rewritten from scratch)_
