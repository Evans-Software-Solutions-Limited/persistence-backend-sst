# 09 — Notifications & Social: Requirements

> **Spec rewritten from scratch on 2026-05-28** to align with the May 2026 design package + the May 2027 M7-backend ship. Prior version preserved in git history.

> **Revised 2026-06-29 (A3 — backend push delivery — supersedes conflicting detail below).**
> The go-live readiness audit (2026-06-28) confirmed the in-app notification
> surface (write/list/prefs/device-register) shipped, but **nothing ever sent
> an actual push** — zero Expo/APNs/FCM send code in the backend. Rows were
> written, never delivered. A3 builds the **server-side delivery layer**. The
> following is authoritative; older inline detail that conflicts is superseded:
>
> 1. **Push delivers via the Expo Push API** (`https://exp.host/--/api/v2/push/send`),
>    raw `fetch`, no SDK — mirroring the outbound-HTTP convention in
>    `revenueCatClient.ts` and the legacy `send-push-notification` Supabase
>    Edge Function (`../persistence-backend/supabase/functions/send-push-notification/index.ts`),
>    which is the canonical reference for the message shape + batching + token
>    handling.
> 2. **The stored device token is the Expo push token** (`ExponentPushToken[…]`),
>    obtained on the client via `getExpoPushTokenAsync()`, **not** the native
>    APNs/FCM token from `getDevicePushTokenAsync()`. This corrects STORY-004
>    AC 4.1 below (and `design.md § Push notification listener`), which predates
>    the Expo-Push-API decision — the native token is not deliverable through
>    the Expo Push API. (See ADDENDUM STORY-010.)
> 3. **Every persisted notification attempts a push** (decision: direction-
>    agnostic — athlete-own AND coach↔client events), gated only by the
>    recipient's per-type preference. The in-app row is the source of truth;
>    the push is a best-effort side-effect that must never lose the row.
> 4. **All 12 live `NOTIFICATION_TYPES` are push-eligible** for v1 (no subset).
>    Per-type opt-out via the existing `notification_preferences` JSONB gates
>    delivery.
> 5. **Quiet hours / do-not-disturb is DEFERRED** (post-launch). No tz/window
>    schema in v1.
> 6. **`EXPO_ACCESS_TOKEN` is optional** — Expo Push send works unauthenticated
>    unless "Enhanced Security for Push" is enabled on the Expo account, in
>    which case it is sent as a Bearer. Wired as an optional SST secret +
>    per-stage CI set; the client omits the `Authorization` header when absent.
>
> See the ADDENDUM section at the foot of this file for the new stories.

> **Revised 2026-06-07 (Phase 09.1 reconciliation — supersedes conflicting detail below).**
> Building the mobile frontend surfaced that the 2026-05-28 rewrite's inline
> taxonomy was aspirational and never matched the shipped backend (PR #81).
> The following is now authoritative; older inline detail that conflicts is
> superseded:
>
> 1. **Taxonomy is producer-owned (9 types, not 11).** The canonical
>    `notification_type` enum has 9 values today —
>    `workout_assigned`, `friend_request`, `pt_request`, `pt_accepted`,
>    `physio_request`, `physio_accepted`, `workout_reminder`,
>    `goal_milestone`, `trainer_feedback`. The streak / nutrition / on-behalf
>    types sketched in the design.md inventory are a **forward-looking list**
>    registered by their producing specs (06 / 13 / 10) when those features
>    ship, via the enum-extension contract (locked decision #10). M7/09 builds
>    against the 9 live types only. `POST /notifications/preferences` 400s any
>    key outside the enum, so the client must not send unshipped keys.
> 2. **Forward-compatible renderer.** An unknown / future `type` from a server
>    ahead of the client renders with a generic fallback visual and stays
>    markable-read — never crashes, never drops the list.
> 3. **List pagination is cursor (keyset), not offset.** The backend list
>    endpoint was realigned offset → cursor to match this spec's design
>    (`GET /notifications?cursor=&limit=` → `{ rows, nextCursor, unreadCount }`).
>    AC 2.9's "confirm" resolves to **cursor**, not `offset`.
> 4. **Wire field mapping (client-side).** The backend row uses `message`,
>    `isRead`+`readAt`, and `data` (deep-link lives in `data.deepLink`). The
>    mobile adapter maps these onto the domain `Notification`
>    (`body`, `readAt`, `deepLink`) at the adapter boundary — no DB column
>    rename. Default opt-in is "all 9 on" (matches the backend read-default).
> 5. **Preferences categories** are reconciled to the 9 live types
>    (Workouts / Goals / Trainer & Physio / Social) — see design.md.
> 6. **List uses `FlatList`** (FlashList swap deferred to M11 perf work per the
>    MEMORY ledger); the data/renderItem/refresh/onEndReached contract is
>    identical so the swap is mechanical.
> 7. **Mark-read `read_at` semantics (clarifies locked decision #3 / STORY-006
>    AC 6.4).** `PATCH /notifications/:id` accepts only `{ isRead: true }` and
>    stamps `read_at = COALESCE(read_at, NOW())` server-side. So the SERVER
>    records the first-flush moment (it never receives a client timestamp),
>    and COALESCE makes sync-queue replays idempotent (a re-flush can't
>    advance `read_at`). The user's offline-tap moment is preserved in the
>    LOCAL SQLite cache (also COALESCE). The original spec wording
>    "read_at = original-mark moment" is reconciled to this: original-mark
>    moment lives client-side; server-side guarantee is replay-idempotency.

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

## ADDENDUM 2026-06-29 — Backend push delivery (A3)

> Implementation reference: the legacy Expo send path at
> `../persistence-backend/supabase/functions/send-push-notification/index.ts`
> (Expo Push API, `ExponentPushToken[…]`, `{ to, sound, title, body, data,
priority, channelId }` message shape). A3 ports that into the SST backend,
> adds per-type preference gating (legacy had none), and adds dead-token
> deactivation (legacy had none).

### STORY-008: As any notification recipient, I receive a push for events I haven't muted

**Acceptance Criteria:**

- 8.1 [ ] Every call that persists an in-app notification (the
  `NotificationRepository.create` choke point — streak engine, trainer
  invite-code accept, and all future coach↔client producers) also attempts a
  push to the recipient's active devices.
- 8.2 [ ] The push is sent via the Expo Push API (`https://exp.host/--/api/v2/push/send`)
  using raw `fetch` (no SDK), mirroring `revenueCatClient.ts`.
- 8.3 [ ] Delivery is gated by the recipient's `notification_preferences`: if the
  notification's `type` is explicitly `false`, the in-app row is still written
  but **no push is sent**. Missing key → default `true` (opt-out model).
- 8.4 [ ] The in-app write and the push are decoupled: a push failure (network,
  Expo 5xx, malformed token) is caught + logged and **never** throws back to the
  producer or loses the persisted row.
- 8.5 [ ] Only `user_devices` rows with `is_active = true` for the recipient are
  targeted. A user with no active devices is a no-op (row still written).
- 8.6 [ ] Messages are batched at ≤100 per Expo request (Expo's documented cap);
  ticket ordering is preserved so each ticket maps back to its source token.
- 8.7 [ ] Ownership: the recipient `userId` is supplied by the trusted emitter
  (the JWT subject of the triggering event / the row's `user_id`), never from a
  request body. Device + preference lookups scope to that `userId`.

### STORY-009: As the system, I retire dead device tokens so they aren't retried forever

**Acceptance Criteria:**

- 9.1 [ ] When an Expo push **ticket** comes back with `status: "error"` and
  `details.error === "DeviceNotRegistered"`, the corresponding `user_devices`
  row is set `is_active = false` (scoped to `(user_id, device_token)`).
- 9.2 [ ] Other ticket errors (e.g. `MessageTooBig`, `MessageRateExceeded`) are
  logged but do not deactivate the token.
- 9.3 [ ] Deactivation failures are isolated — they never throw back into the
  notification write path.
- 9.4 [ ] Full delivery-**receipt** polling (the async `/push/getReceipts` step,
  which can surface `DeviceNotRegistered` later) is **deferred** post-launch;
  v1 acts on the synchronous ticket response only. Documented in `design.md`.

### STORY-010: As the mobile client, I register the Expo push token (not the native token)

**Acceptance Criteria:**

- 10.1 [ ] The client obtains its token via `getExpoPushTokenAsync({ projectId })`
  (EAS project id from app config), yielding an `ExponentPushToken[…]` string —
  **superseding** STORY-004 AC 4.1's `getDevicePushTokenAsync()` (native token,
  not deliverable via the Expo Push API).
- 10.2 [ ] That Expo token is POSTed to `/devices/register` (existing endpoint,
  unchanged) and is what the backend send path targets.
- 10.3 [ ] `app.json` carries `ios.entitlements["aps-environment"]` so the EAS
  build provisions APNs. (Brad enables the Push Notifications capability in
  Apple Developer + uploads the APNs key to Expo via `eas credentials`.)
- 10.4 [ ] Re-registration on auth change + Expo token rotation is unchanged
  (STORY-004 AC 4.4) — it just carries the corrected token type.

### Decisions locked (A3)

| #   | Decision            | Value                                                                                  |
| --- | ------------------- | -------------------------------------------------------------------------------------- |
| 11  | Send transport      | Expo Push API, raw `fetch`, no SDK. Ports the legacy Edge Function.                    |
| 12  | Push-eligible types | All 12 live `NOTIFICATION_TYPES`. Per-type pref gates delivery.                        |
| 13  | Direction           | Direction-agnostic — every persisted notification pushes (athlete-own + coach↔client). |
| 14  | Quiet hours / DND   | Deferred post-launch.                                                                  |
| 15  | Token type          | Expo push token (`getExpoPushTokenAsync`). Native token path corrected.                |
| 16  | `EXPO_ACCESS_TOKEN` | Optional SST secret; Bearer only when present. Wired into both deploy workflows.       |
| 17  | Receipt polling     | Deferred; act on synchronous ticket response (incl. `DeviceNotRegistered`) only.       |

---

_End of `09-notifications-social/requirements.md` · 2026-05-28 (rewritten from scratch)_
